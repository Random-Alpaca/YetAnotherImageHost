// Thin fetch wrapper. Always sends cookies; throws an Error with the server's
// message on non-2xx so callers can show it.
async function request(path, { method = "GET", body, isForm = false } = {}) {
  const opts = { method, credentials: "include", headers: {} };
  if (body != null) {
    if (isForm) {
      opts.body = body; // FormData; let the browser set the boundary
    } else {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    throw new Error(data?.error || `request failed (${res.status})`);
  }
  return data;
}

// Multipart POST via XHR (fetch can't report upload progress). Same contract as
// request(): resolves parsed JSON, rejects with the server's error message.
function sendForm(path, body, onBytes) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onBytes?.(e.loaded);
    xhr.onerror = () => reject(new Error("network error"));
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* no body */ }
      if (xhr.status < 200 || xhr.status >= 300) {
        return reject(new Error(data?.error || `request failed (${xhr.status})`));
      }
      resolve(data);
    };
    xhr.send(body);
  });
}

// Aggregates per-file byte progress into onProgress({ done, total, loaded, bytes }).
function tracker(files, onProgress) {
  const per = files.map(() => 0);
  const bytes = files.reduce((n, f) => n + f.size, 0) || 1;
  let done = 0;
  const emit = () =>
    onProgress?.({ done, total: files.length, loaded: per.reduce((a, b) => a + b, 0), bytes });
  return {
    bytes: (i) => (loaded) => { per[i] = Math.min(loaded, files[i].size); emit(); },
    finish: (i) => { per[i] = files[i].size; done++; emit(); },
  };
}

export const api = {
  // Auth
  me: () => request("/api/me"),
  login: (username, password) =>
    request("/api/login", { method: "POST", body: { username, password } }),
  logout: () => request("/api/logout", { method: "POST" }),

  // Account self-service
  changePassword: (currentPassword, newPassword) =>
    request("/api/me/password", { method: "POST", body: { currentPassword, newPassword } }),

  // User management (any authed user can create; admin-only list/revoke/delete)
  createUser: (username, password, role) =>
    request("/api/users", { method: "POST", body: { username, password, role } }),
  listUsers: () => request("/api/users"),
  userNames: () => request("/api/users/names"),
  revokeUser: (id) => request(`/api/users/${id}/revoke`, { method: "POST" }),
  deleteUser: (id) => request(`/api/users/${id}`, { method: "DELETE" }),

  // Signup requests (queue reviewed by admins)
  signup: (username, password) =>
    request("/api/users/signup", { method: "POST", body: { username, password } }),
  listSignupRequests: () => request("/api/users/requests"),
  approveSignupRequest: (id) => request(`/api/users/requests/${id}/approve`, { method: "POST" }),
  rejectSignupRequest: (id) => request(`/api/users/requests/${id}`, { method: "DELETE" }),

  // Folders
  listFolders: () => request("/api/folders"),
  createFolder: (name, parentId) =>
    request("/api/folders", { method: "POST", body: { name, parent_id: parentId ?? null } }),
  deleteFolder: (id) => request(`/api/folders/${id}`, { method: "DELETE" }),
  // Sharing: any subset of { access, is_public, public_upload, shared_with }
  updateFolder: (id, patch) => request(`/api/folders/${id}`, { method: "PATCH", body: patch }),

  // Public albums — no session needed, the slug is the credential
  getAlbum: (slug) => request(`/api/albums/${slug}`),
  albumUpload: async (slug, files, onProgress) => {
    const list = Array.from(files);
    const t = tracker(list, onProgress);
    const results = [];
    for (const file of list) {
      const i = results.length;
      const fd = new FormData();
      fd.append("file", file);
      try {
        const data = await sendForm(`/api/albums/${slug}/upload`, fd, t.bytes(i));
        results.push(data?.results?.[0] || { name: file.name, ok: false, error: "no result returned" });
      } catch (err) {
        results.push({ name: file.name, ok: false, error: err.message });
      }
      t.finish(i);
    }
    return { results };
  },

  // Images — list with optional folder filter
  listImages: (folder) => {
    const qs = folder !== undefined ? `?folder=${encodeURIComponent(folder)}` : "";
    return request(`/api/images/list${qs}`);
  },
  deleteImage: (id) => request(`/api/images/${id}`, { method: "DELETE" }),

  // Visibility toggle → returns { id, visibility, url }
  setVisibility: (id, visibility) =>
    request(`/api/images/${id}/visibility`, { method: "PATCH", body: { visibility } }),

  // Move single image to a folder (null to remove from folder)
  moveImage: (id, folderId) =>
    request(`/api/images/${id}`, { method: "PATCH", body: { folder_id: folderId } }),

  // Bulk action: action = "delete" | "move"; folderId optional for move
  bulkImages: (action, ids, folderId) =>
    request("/api/images/bulk", {
      method: "POST",
      body: { action, ids, ...(folderId !== undefined ? { folder_id: folderId } : {}) },
    }),

  // Bulk upload: each file is its own request, run with bounded concurrency.
  // One file per request keeps every body under the per-file size limit (so a
  // big batch never trips nginx's whole-body cap), and a single failure never
  // sinks the rest. Returns { results: [{name, ok, url, ...}] } in input order.
  upload: async (files, visibility, { concurrency = 4, folderId, folderName, onProgress } = {}) => {
    const list = Array.from(files);
    const results = new Array(list.length);
    let next = 0;
    const t = tracker(list, onProgress);
    async function worker() {
      while (next < list.length) {
        const i = next++;
        const file = list[i];
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("visibility", visibility);
          if (folderId !== undefined && folderId !== null) {
            fd.append("folder_id", folderId);
          } else if (folderName) {
            fd.append("folder_name", folderName);
          }
          const data = await sendForm("/api/upload", fd, t.bytes(i));
          results[i] = data?.results?.[0] || { name: file.name, ok: false, error: "no result returned" };
        } catch (err) {
          results[i] = { name: file.name, ok: false, error: err.message };
        }
        t.finish(i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    return { results };
  },
};
