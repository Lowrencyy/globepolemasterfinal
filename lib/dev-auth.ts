export const DEV_BYPASS_AUTH = __DEV__ && true;

export const DEV_BYPASS_USER = {
  id: 0,
  company: "globe",
  role: "admin",
  first_name: "UI",
  last_name: "Developer",
  full_name: "UI Developer",
  email: "ui-dev@telcovantage.local",
  cellphone: null,
  profile_photo: null,
  status: "active",
  password_reset_required: false,
  team_id: null,
  subcontractor_id: null,
  subcontractor_name: null,
  last_login: null,
  is_online: true,
  is_admin: true,
  is_executive: false,
  is_driver: false,
} as const;
