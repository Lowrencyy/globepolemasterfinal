import api from "./api";

export type PoleBarangay = {
  code: string;
  name: string;
  city_code: string;
};

export type Pole = {
  id: number;
  pole_code: string;
  barangay_code: string | null;
  lat: string | null;
  lng: string | null;
  globe_status: string | null;
  barangay?: PoleBarangay;
};

export type PoleListResponse = {
  data: Pole[];
  last_page: number;
  current_page: number;
  total: number;
  meta?: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
};

export function getPoles(
  token: string,
  params?: { search?: string; barangay_code?: string; page?: number; per_page?: number }
) {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.barangay_code) query.set("barangay_code", params.barangay_code);
  if (params?.page) query.set("page", String(params.page));
  if (params?.per_page) query.set("per_page", String(params.per_page));
  const qs = query.toString() ? `?${query.toString()}` : "";
  return api.request<PoleListResponse>(`/globe/poles${qs}`, {}, token);
}

export function createPole(
  token: string,
  body: {
    pole_code: string;
    barangay_code?: string | null;
    lat?: string | null;
    lng?: string | null;
  }
) {
  return api.request<Pole>(
    `/globe/poles`,
    { method: "POST", body: JSON.stringify(body) },
    token
  );
}
