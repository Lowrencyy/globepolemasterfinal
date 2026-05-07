import api from "./api";
import { useAuth } from "@/context/auth-context";

export interface SkycableArea {
  id: number;
  name: string;
  nodes_count: number;
  pending_count: number;
  in_progress_count: number;
  completed_count: number;
}

export interface SkycableNode {
  id: number;
  site_id: number;
  area_id: number;
  name: string;
  status: "pending" | "in_progress" | "completed";
  poles_count?: number; // Might not be returned directly, but let's assume or handle it
  expected_cable_meters?: number;
  city?: string;
  barangay_name?: string;
}

export interface SkycablePole {
  id: number;
  node_id: number;
  pole_id: number;
  sequence: number;
  pole: {
    id: number;
    pole_code: string;
    lat: string;
    lng: string;
    skycable_status: "pending" | "in_progress" | "cleared";
    cableSlots: {
      slot_label: string;
      occupied_by: string;
    }[];
  };
}

export const getAreas = async (token: string): Promise<SkycableArea[]> => {
  return api.request<SkycableArea[]>("/skycable/areas", {}, token);
};

export const getNodes = async (areaId: number, token: string): Promise<{ data: SkycableNode[] }> => {
  // API returns paginated nodes: { data: [...] }
  return api.request<{ data: SkycableNode[] }>(`/skycable/nodes?area_id=${areaId}`, {}, token);
};

export const getNodePoles = async (nodeId: number, token: string): Promise<SkycablePole[]> => {
  return api.request<SkycablePole[]>(`/skycable/nodes/${nodeId}/poles`, {}, token);
};
