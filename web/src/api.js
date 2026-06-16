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
  me: () => request("/api/me"),
  login: (password) => request("/api/login", { method: "POST", body: { password } }),
  logout: () => request("/api/logout", { method: "POST" }),

  listImages: () => request("/api/images/list"),
  deleteImage: (id) => request(`/api/images/${id}`, { method: "DELETE" }),
  // Bulk upload: each file is its own request, run with bounded concurrency.
  // One file per request keeps every body under the per-file size limit (so a
  // big batch never trips nginx's whole-body cap), and a single failure never
  // sinks the rest. Returns { results: [{name, ok, url, ...}] } in input order.
  upload: async (files, visibility, { concurrency = 4 } = {}) => {
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

  listPasswords: () => request("/api/admin/passwords"),
  issuePassword: (label, role) =>
    request("/api/admin/passwords", { method: "POST", body: { label, role } }),
  revokePassword: (id) =>
    request(`/api/admin/passwords/${id}/revoke`, { method: "POST" }),
};
