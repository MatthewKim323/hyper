/* eslint-disable @typescript-eslint/no-explicit-any */
// Project data ships in lib/data/projects.json and is exposed on window before readers run.
import projectsJson from "@/lib/data/projects.json";

export type ProjectImage = {
  name: string;
  image: string;
  image_size: [number, number];
  type: string;
  position: { x: number; y: number; z: number };
};

export type ProjectEntry = {
  project: {
    "0internal_or_external": string;
    title: string;
    description: string;
    link?: string;
    bg_color?: string;
    light_mode?: boolean;
    project_grid_category: string[] | false;
  };
  images: ProjectImage[];
  videos: false | any[];
  models: false | any[];
};

export function ensureProjects(): ProjectEntry[] {
  if (!window.projects) window.projects = projectsJson as unknown as ProjectEntry[];
  return window.projects;
}
