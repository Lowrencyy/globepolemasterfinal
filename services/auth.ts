import api from "./api";

export type GlobeUser = {
  id: number;
  company: string;
  role: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  cellphone: string | null;
  profile_photo: string | null;
  status: string;
  password_reset_required: boolean;
  team_id: number | null;
  subcontractor_id: number | null;
  last_login: string | null;
  is_online: boolean;
};

export type LoginResponse = {
  token: string;
  password_reset_required: boolean;
  user: GlobeUser;
};

export function loginGlobe(email: string, password: string) {
  return api.request<LoginResponse>("/skycable/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logoutGlobe(token: string) {
  return api.request<void>("/skycable/auth/logout", { method: "POST" }, token);
}
