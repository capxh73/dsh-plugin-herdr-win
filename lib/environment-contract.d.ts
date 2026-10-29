import { z } from "zod";
//#region src/core/environment.d.ts
/** Wire-only environment facts. Platform always belongs to the DSH Host, not the browser. */
interface HerdrEnvironmentReport {
  checkedAt: number;
  host: {
    platform: string;
    arch: string;
    hostname: string;
    nodeVersion: string;
    wsl: boolean;
  };
  supported: boolean;
  cli: {
    state: 'available' | 'missing' | 'unusable' | 'unsupported';
    path: string | null;
    version: string | null;
  };
  packageManagers: {
    npm: boolean;
    pnpm: boolean;
  };
  connection: {
    socketPath: string | null;
    session: string | null;
    running: boolean;
    version: string | null;
    protocol: number | null;
  };
  terminal: {
    enabled: boolean;
    available: boolean;
  };
  verified: {
    version: string;
    protocol: number;
  };
}
//#endregion
//#region src/host/environment/schema.d.ts
/** The new read-only Remote has a real wire codec instead of an unknown placeholder. */
declare const environmentSchema: z.ZodType<HerdrEnvironmentReport>;
//#endregion
export { environmentSchema };