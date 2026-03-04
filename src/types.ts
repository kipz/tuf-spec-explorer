export interface ConstraintChange {
  type: 'added' | 'removed' | 'relaxed';
  constraintId: string;
  description?: string;
  before?: string;
  after?: string;
  detail: string;
}

export interface Incompatibility {
  description: string;
  severity: 'breaking' | 'warning';
}

export interface SecurityImpact {
  mitigates: string[];
  description: string;
}

export interface Tap {
  tap: number;
  title: string;
  status: 'Accepted' | 'Draft' | 'Rejected' | 'Deferred';
  url: string;
  summary: string;
  dependencies: number[];
  requiresMajorBump: boolean;
  constraintChanges: ConstraintChange[];
  incompatibilities?: Incompatibility[];
  securityImpact: SecurityImpact;
}

export interface Constraint {
  id: string;
  description: string;
  specSection: string;
  status: 'active';
}

export interface Role {
  description: string;
  keyPolicy: string;
  constraints: string[];
}

export interface TapInteraction {
  taps: number[];
  type: 'synergy' | 'tension' | 'conflict' | 'compound';
  severity: 'info' | 'warning' | 'breaking';
  title: string;
  description: string;
  constraintEffects?: Array<{
    type: 'added' | 'removed' | 'relaxed';
    constraintId: string;
    description: string;
  }>;
}

export interface TapSupport {
  tap: number;
  level: 'full' | 'partial';
  notes?: string;
}

export type ImplementationTier = 'core' | 'third-party' | 'sigstore' | 'system';
export type ImplementationStatus = 'active' | 'pre-production' | 'alpha' | 'archived';

export interface Implementation {
  id: string;
  name: string;
  language: string;
  githubUrl: string;
  status: ImplementationStatus;
  tier: ImplementationTier;
  specVersion: string;
  conformancePercent?: number;
  tapSupport: TapSupport[];
  notes?: string;
}

export interface SpecData {
  spec: {
    version: string;
    lastModified: string;
    url: string;
    editors: string[];
    roles: Record<string, Role>;
    attacks: string[];
    constraints: Record<string, Constraint>;
  };
  incorporatedTaps: Array<{
    tap: number;
    title: string;
    status: string;
    summary: string;
  }>;
  taps: Tap[];
  tapInteractions: TapInteraction[];
  processTaps: Array<{
    tap: number;
    title: string;
    notes: string;
  }>;
  implementations: Implementation[];
}
