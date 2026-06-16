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
  upload: (file, visibility) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("visibility", visibility);
    return request("/api/upload", { method: "POST", body: fd, isForm: true });
  },

  listPasswords: () => request("/api/admin/passwords"),
  issuePassword: (label, role) =>
    request("/api/admin/passwords", { method: "POST", body: { label, role } }),
  revokePassword: (id) =>
    request(`/api/admin/passwords/${id}/revoke`, { method: "POST" }),
};
