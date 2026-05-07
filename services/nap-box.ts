import api from "./api";

export type NapPort = {
  id: number;
  nap_box_id: number;
  port_number: number;
  status: "active" | "inactive" | "free";
  subscriber_id: string | null;
  subscriber_name: string | null;
  account_number: string | null;
  surveyed_by: number | null;
  surveyed_at: string | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
};

export type NapBarangay = {
  code: string;
  name: string;
  city_code: string;
};

export type NapPole = {
  id: number;
  pole_code: string;
  barangay_code: string;
  lat: string;
  lng: string;
  globe_status: string | null;
  barangay: NapBarangay;
};

export type NapBox = {
  id: number;
  pole_id: number;
  nap_code: string;
  port_count: "8" | "12" | "16" | "32";
  status: "active" | "inactive" | "for_removal";
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  pole?: NapPole;
  ports?: NapPort[];
};

export type NapBoxListResponse = {
  data: NapBox[];
  meta: {
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
  };
};

// {pole} in the path is ignored by the backend — filtering is via ?pole_id query param
export function getNapBoxes(
  token: string,
  params?: { pole_id?: number; status?: string; page?: number }
) {
  const query = new URLSearchParams();
  if (params?.pole_id) query.set("pole_id", String(params.pole_id));
  if (params?.status) query.set("status", params.status);
  if (params?.page) query.set("page", String(params.page));
  const qs = query.toString() ? `?${query.toString()}` : "";
  return api.request<NapBoxListResponse>(
    `/globe/poles/0/nap-boxes${qs}`,
    {},
    token
  );
}

export function getNapBox(id: number, token: string) {
  return api.request<NapBox>(`/globe/nap-boxes/${id}`, {}, token);
}

export function getNapBoxPorts(id: number, token: string) {
  return api.request<NapPort[]>(`/globe/nap-boxes/${id}/ports`, {}, token);
}

export function updatePort(
  napBoxId: number,
  portNumber: number,
  token: string,
  body: {
    status: "active" | "inactive" | "free";
    subscriber_id?: string | null;
    subscriber_name?: string | null;
    account_number?: string | null;
  }
) {
  return api.request<NapPort>(
    `/globe/nap-boxes/${napBoxId}/ports/${portNumber}`,
    { method: "PUT", body: JSON.stringify(body) },
    token
  );
}

export function createNapBox(
  token: string,
  body: {
    pole_id: number;
    nap_code: string;
    port_count: "8" | "12" | "16" | "32";
    status?: "active" | "inactive";
  }
) {
  return api.request<NapBox>(
    `/globe/nap-boxes`,
    { method: "POST", body: JSON.stringify(body) },
    token
  );
}

export function countUsedPorts(ports: NapPort[]) {
  return ports.filter((p) => p.status !== "free").length;
}
