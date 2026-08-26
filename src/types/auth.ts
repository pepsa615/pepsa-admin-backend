export interface AuthenticatedAdmin {
  id: string;
  email: string;
  name: string;
  sessionId: string;
  csrfToken: string;
  permissions: Set<string>;
  platformIds: Set<string>;
  assignmentScopes: Array<{
    platformId?: string;
    environmentId?: string;
    resourceScope?: Record<string, unknown>;
    permissions: string[];
  }>;
  stepUpAt?: Date;
}

declare global {
  // Express exposes its request extension point as a namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AuthenticatedAdmin;
    }
  }
}

export {};
