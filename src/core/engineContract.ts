import { Squishy } from './Squishy';
import { InteractionMode } from './types';

export interface ISquishyStageCallbacks {
  onSquishUpdate?: (squishy: Squishy) => void;
  onSqueezeTriggered?: (squishy: Squishy, intensity: number) => void;
}

export interface ISquishyStage3D {
  loadSquishy(squishy: Squishy): void;
  getCurrentSquishy(): Squishy;
  setInteractionMode(mode: InteractionMode): void;
  getInteractionMode(): InteractionMode;
  triggerMegaSquish(intensity?: number): void;
  triggerPokeAtCenter(intensity?: number): void;
  resetDeformationImmediate(): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  dispose(): void;
}
