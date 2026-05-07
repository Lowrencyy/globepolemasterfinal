export type Project = {
  id: number;
  project_name: string;
  project_code: string;
  client: string;
  status: string;
  project_logo: string | null;
};

let _projects: Project[] = [];

export const projectStore = {
  set: (projects: Project[]) => {
    _projects = projects;
  },
  get: (): Project[] => _projects,
  clear: () => {
    _projects = [];
  },
};
