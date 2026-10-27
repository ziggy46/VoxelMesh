// Built-in samples for the import panel. docs/05 lists three; two are built so far (castle, terrain).
import type { VoxelPayload } from "../types/voxelPayload";
import { generateTerrain } from "./fixtures";
import { buildSampleCastle } from "./sampleCastlePayload";

export interface Sample { id: string; name: string; description: string; build: () => VoxelPayload }

export const SAMPLES: readonly Sample[] = [
  { id: "castle", name: "Sample Castle", description: "24 × 16 × 24 blocks: towers, stairs, fences, chains, sealed rooms", build: buildSampleCastle },
  { id: "terrain", name: "Rolling Terrain", description: "24 × 24 × 24 blocks: heightfield with sealed air pockets", build: () => generateTerrain(24).payload },
];
