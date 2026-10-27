import {
  SquishyAudioProps,
  SquishyChangeCategory,
  SquishyChangeListener,
  SquishyConfig,
  SquishyFaceProps,
  SquishyGeometryProps,
  SquishyMaterialProps,
  SquishyPhysicsProps,
  SquishyRuntimeState,
  SquishyTopping
} from './types';

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export class Squishy {
  private _config: SquishyConfig;
  private _initialSnapshot: SquishyConfig;
  private _state: SquishyRuntimeState;
  private _listeners: Set<SquishyChangeListener> = new Set();

  constructor(config: SquishyConfig) {
    this._config = deepClone(config);
    this._initialSnapshot = deepClone(config);
    this._state = {
      currentCompression: 0,
      residualDeformation: 0,
      isRecovering: false,
      isPressed: false,
      squeezeCount: 0,
      satisfactionScore: 0
    };
  }

  get id(): string { return this._config.id; }
  get name(): string { return this._config.name; }
  get subtitle(): string { return this._config.subtitle; }
  get description(): string { return this._config.description; }
  get category(): SquishyConfig['category'] { return this._config.category; }
  get badge(): string | undefined { return this._config.badge; }
  get popularityScore(): number { return this._config.popularityScore; }
  get geometry(): Readonly<SquishyGeometryProps> { return this._config.geometry; }
  get physics(): Readonly<SquishyPhysicsProps> { return this._config.physics; }
  get material(): Readonly<SquishyMaterialProps> { return this._config.material; }
  get face(): Readonly<SquishyFaceProps> { return this._config.face; }
  get audio(): Readonly<SquishyAudioProps> { return this._config.audio; }
  get state(): Readonly<SquishyRuntimeState> { return this._state; }
  get isCustom(): boolean { return Boolean(this._config.isCustom); }

  get estimatedRiseTimeSeconds(): number {
    const speed = clamp(this._config.physics.recoverySpeed, 0.04, 1);
    const visc = clamp(this._config.physics.viscosity, 0.1, 1);
    const raw = (1.15 / Math.pow(speed, 0.78)) * (0.65 + visc * 0.6);
    return Math.round(clamp(raw, 0.4, 8.5) * 10) / 10;
  }

  get feelLabel(): string {
    const r = this._config.physics.recoverySpeed;
    const w = this._config.physics.wobbleIntensity;
    if (r <= 0.14) return 'Ultra Slow-Rising (Mémoire de forme)';
    if (r <= 0.28) return 'Slow-Rising Classique';
    if (w >= 0.55) return 'Taba Mochi / Gelée Rebondissante';
    return 'Mousse Souple Réactive';
  }

  updateMeta(patch: Partial<Pick<SquishyConfig, 'name' | 'subtitle' | 'description' | 'category' | 'badge'>>): this {
    Object.assign(this._config, patch);
    this.emit('meta');
    return this;
  }

  updatePhysics(patch: Partial<SquishyPhysicsProps>): this {
    this._config.physics = {
      ...this._config.physics,
      ...patch,
      softness: clamp(patch.softness ?? this._config.physics.softness, 0.15, 1.0),
      recoverySpeed: clamp(patch.recoverySpeed ?? this._config.physics.recoverySpeed, 0.04, 0.95),
      viscosity: clamp(patch.viscosity ?? this._config.physics.viscosity, 0.1, 0.98),
      poissonRatio: clamp(patch.poissonRatio ?? this._config.physics.poissonRatio, 0.05, 0.75),
      squeezeRadius: clamp(patch.squeezeRadius ?? this._config.physics.squeezeRadius, 0.25, 1.6),
      wobbleIntensity: clamp(patch.wobbleIntensity ?? this._config.physics.wobbleIntensity, 0.0, 1.0),
      stickiness: clamp(patch.stickiness ?? this._config.physics.stickiness, 0.0, 1.0)
    };
    this.emit('physics');
    return this;
  }

  updateMaterial(patch: Partial<Omit<SquishyMaterialProps, 'toppings'>>): this {
    this._config.material = {
      ...this._config.material,
      ...patch,
      gradientStrength: clamp(patch.gradientStrength ?? this._config.material.gradientStrength, 0, 1),
      roughness: clamp(patch.roughness ?? this._config.material.roughness, 0.02, 1),
      clearcoat: clamp(patch.clearcoat ?? this._config.material.clearcoat, 0, 1),
      transmission: clamp(patch.transmission ?? this._config.material.transmission, 0, 0.95)
    };
    this.emit('material');
    return this;
  }

  updateGeometry(patch: Partial<SquishyGeometryProps>): this {
    this._config.geometry = {
      ...this._config.geometry,
      ...patch,
      scale: patch.scale ? { ...this._config.geometry.scale, ...patch.scale } : this._config.geometry.scale,
      roundness: clamp(patch.roundness ?? this._config.geometry.roundness, 0.1, 1.0)
    };
    this.emit('geometry');
    return this;
  }

  updateFace(patch: Partial<SquishyFaceProps>): this {
    this._config.face = {
      ...this._config.face,
      ...patch,
      blushIntensity: clamp(patch.blushIntensity ?? this._config.face.blushIntensity, 0, 1),
      scale: clamp(patch.scale ?? this._config.face.scale, 0.4, 1.8)
    };
    this.emit('face');
    return this;
  }

  updateAudio(patch: Partial<SquishyAudioProps>): this {
    this._config.audio = {
      ...this._config.audio,
      ...patch,
      pitch: clamp(patch.pitch ?? this._config.audio.pitch, 0.5, 1.8),
      volume: clamp(patch.volume ?? this._config.audio.volume, 0, 1)
    };
    this.emit('audio');
    return this;
  }

  toggleTopping(toppingId: string, enabled?: boolean): this {
    const target = this._config.material.toppings.find((t) => t.id === toppingId);
    if (target) {
      target.enabled = enabled !== undefined ? enabled : !target.enabled;
      this.emit('toppings');
    }
    return this;
  }

  addOrUpdateTopping(topping: SquishyTopping): this {
    const idx = this._config.material.toppings.findIndex((t) => t.id === topping.id);
    if (idx >= 0) {
      this._config.material.toppings[idx] = { ...topping };
    } else {
      this._config.material.toppings.push({ ...topping });
    }
    this.emit('toppings');
    return this;
  }

  resetToPresetDefaults(): this {
    this._config = deepClone(this._initialSnapshot);
    this.emit('reset');
    return this;
  }

  registerSqueeze(intensity: number): void {
    this._state.squeezeCount += 1;
    this._state.satisfactionScore = Math.min(
      99999,
      Math.round(this._state.satisfactionScore + intensity * 18 * (0.8 + this._config.physics.softness * 0.5))
    );
    this.emit('state');
  }

  syncDeformationState(params: {
    currentCompression: number;
    residualDeformation: number;
    isPressed: boolean;
    isRecovering: boolean;
  }): void {
    this._state.currentCompression = clamp(params.currentCompression, 0, 1);
    this._state.residualDeformation = clamp(params.residualDeformation, 0, 1);
    this._state.isPressed = params.isPressed;
    this._state.isRecovering = params.isRecovering;
  }

  subscribe(listener: SquishyChangeListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private emit(category: SquishyChangeCategory): void {
    for (const listener of this._listeners) {
      listener(this, category);
    }
  }

  toConfig(): SquishyConfig {
    return deepClone(this._config);
  }

  toJSON(): string {
    return JSON.stringify(this._config, null, 2);
  }

  clone(overrides?: Partial<SquishyConfig>): Squishy {
    const copy = deepClone(this._config);
    if (overrides) {
      Object.assign(copy, overrides);
    }
    return new Squishy(copy);
  }

  static fromJSON(json: string | SquishyConfig): Squishy {
    const parsed: SquishyConfig = typeof json === 'string' ? JSON.parse(json) : json;
    return new Squishy(parsed);
  }
}

export class SquishyBuilder {
  private config: SquishyConfig;

  constructor(basePreset?: Squishy) {
    if (basePreset) {
      this.config = basePreset.toConfig();
      this.config.id = `custom-${Date.now()}`;
      this.config.isCustom = true;
      this.config.category = 'Custom';
      this.config.createdAt = new Date().toISOString();
    } else {
      this.config = {
        id: `custom-${Date.now()}`,
        name: 'Mon Squishy Custom',
        subtitle: 'Création originale',
        description: 'Squishy personnalisé créé dans le Squishy Lab.',
        category: 'Custom',
        popularityScore: 100,
        isCustom: true,
        createdAt: new Date().toISOString(),
        geometry: {
          shape: 'cat-paw',
          scale: { x: 1, y: 1, z: 1 },
          roundness: 0.85,
          subdivisions: 64
        },
        physics: {
          softness: 0.82,
          recoverySpeed: 0.18,
          viscosity: 0.78,
          poissonRatio: 0.42,
          squeezeRadius: 0.85,
          wobbleIntensity: 0.35,
          stickiness: 0.5
        },
        material: {
          primaryColor: '#ff9ebb',
          secondaryColor: '#fff0f5',
          accentColor: '#ff5c8a',
          gradientStrength: 0.65,
          finish: 'glossy-jelly',
          roughness: 0.18,
          clearcoat: 0.85,
          transmission: 0.35,
          toppings: []
        },
        face: {
          style: 'kawaii-happy',
          eyeColor: '#2d1e2f',
          blushColor: '#ff5d8f',
          blushIntensity: 0.75,
          scale: 1.0,
          offsetY: 0.05,
          reactiveToSquish: true
        },
        audio: {
          profile: 'taba-jelly',
          pitch: 1.0,
          volume: 0.7
        }
      };
    }
  }

  setIdentity(name: string, subtitle: string, description = ''): this {
    this.config.name = name;
    this.config.subtitle = subtitle;
    if (description) this.config.description = description;
    return this;
  }

  setShape(shape: SquishyGeometryProps['shape'], scale = { x: 1, y: 1, z: 1 }): this {
    this.config.geometry.shape = shape;
    this.config.geometry.scale = scale;
    return this;
  }

  setPhysics(physics: Partial<SquishyPhysicsProps>): this {
    Object.assign(this.config.physics, physics);
    return this;
  }

  setMaterial(material: Partial<SquishyMaterialProps>): this {
    Object.assign(this.config.material, material);
    return this;
  }

  setFace(face: Partial<SquishyFaceProps>): this {
    Object.assign(this.config.face, face);
    return this;
  }

  setAudio(audio: Partial<SquishyAudioProps>): this {
    Object.assign(this.config.audio, audio);
    return this;
  }

  build(): Squishy {
    return new Squishy(this.config);
  }
}
