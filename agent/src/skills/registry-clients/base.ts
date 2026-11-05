export interface InstallRequest { slug?: string; url?: string; query?: string; }
export interface InstalledSkill { slug: string; dir: string; }
export interface RegistryClient {
  id: string;
  install(req: InstallRequest, targetDir: string): Promise<InstalledSkill>;
}
