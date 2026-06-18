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

export const api = {
  // Auth
  me: () => request("/api/me"),
  login: (username, password) =>
    request("/api/login", { method: "POST", body: { username, password } }),
  logout: () => request("/api/logout", { method: "POST" }),

  // Account self-service
  changePassword: (currentPassword, newPassword) =>
    request("/api/me/password", { method: "POST", body: { currentPassword, newPassword } }),

  // User management (any authed user can create; admin-only list/revoke)
  createUser: (username, password, role) =>
    request("/api/users", { method: "POST", body: { username, password, role } }),
  listUsers: () => request("/api/users"),
  revokeUser: (id) => request(`/api/users/${id}/revoke`, { method: "POST" }),

  // Folders
  listFolders: () => request("/api/folders"),
  createFolder: (name, parentId) =>
    request("/api/folders", { method: "POST", body: { name, parent_id: parentId ?? null } }),
  deleteFolder: (id) => request(`/api/folders/${id}`, { method: "DELETE" }),

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
  upload: async (files, visibility, { concurrency = 4, folderId, folderName } = {}) => {
    const list = Array.from(files);
    const results = new Array(list.length);
    let next = 0;
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
          const data = await request("/api/upload", { method: "POST", body: fd, isForm: true });
          results[i] = data?.results?.[0] || { name: file.name, ok: false, error: "no result returned" };
        } catch (err) {
          results[i] = { name: file.name, ok: false, error: err.message };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    return { results };
  },
};
