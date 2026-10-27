import { Squishy } from '../core/Squishy';
import { SquishyConfig } from '../core/types';

export const POPULAR_SQUISHY_CONFIGS: SquishyConfig[] = [
  {
    id: 'creamy-butter-block',
    name: 'Butter Squishy',
    subtitle: 'Beurre Tendre Slow-Rising',
    description:
      'La fameuse plaquette de beurre ultra-fondante et lisse avec son carré qui fond sur le dessus : texture crémeuse et reprise de forme ultra-lente.',
    category: 'Viral TikTok',
    badge: '🧈 Butter Texture',
    popularityScore: 98,
    geometry: {
      shape: 'butter',
      scale: { x: 1.25, y: 0.72, z: 0.88 },
      roundness: 0.72,
      subdivisions: 68
    },
    physics: {
      softness: 0.93,
      recoverySpeed: 0.13,
      viscosity: 0.90,
      poissonRatio: 0.46,
      squeezeRadius: 1.0,
      wobbleIntensity: 0.16,
      stickiness: 0.42
    },
    material: {
      primaryColor: '#ffe66d',
      secondaryColor: '#fff7c2',
      accentColor: '#f4b942',
      gradientStrength: 0.65,
      finish: 'matte-foam',
      roughness: 0.34,
      clearcoat: 0.45,
      transmission: 0.08,
      toppings: [
        {
          id: 'melting-butter-pat',
          type: 'butter-pat',
          color: '#fff394',
          secondaryColor: '#ffd13b',
          scale: 1.0,
          enabled: true
        }
      ]
    },
    face: {
      style: 'kawaii-happy',
      eyeColor: '#3b2818',
      blushColor: '#ff8577',
      blushIntensity: 0.8,
      scale: 0.95,
      offsetY: -0.02,
      reactiveToSquish: true
    },
    audio: {
      profile: 'foam-slow',
      pitch: 0.88,
      volume: 0.82
    }
  },
  {
    id: 'taba-cat-paw',
    name: 'Taba Patte de Chat',
    subtitle: 'Mochi Gel Silicone Ultra-Viral',
    description:
      'La célèbre patte de chat Taba Squishy virale sur TikTok : coussinets roses translucides, toucher mochi gélifié et rebond ultra-satisfaisant.',
    category: 'Viral TikTok',
    badge: '🔥 #1 TikTok',
    popularityScore: 99,
    geometry: {
      shape: 'cat-paw',
      scale: { x: 1.08, y: 0.92, z: 1.05 },
      roundness: 0.92,
      subdivisions: 72
    },
    physics: {
      softness: 0.92,
      recoverySpeed: 0.24,
      viscosity: 0.72,
      poissonRatio: 0.48,
      squeezeRadius: 0.95,
      wobbleIntensity: 0.62,
      stickiness: 0.78
    },
    material: {
      primaryColor: '#fff5f8',
      secondaryColor: '#ffd6e7',
      accentColor: '#ff6fa5',
      gradientStrength: 0.55,
      finish: 'glossy-jelly',
      roughness: 0.12,
      clearcoat: 0.95,
      transmission: 0.42,
      toppings: [
        {
          id: 'paw-beans',
          type: 'cat-beans',
          color: '#ff7aa8',
          secondaryColor: '#ff4d88',
          scale: 1.0,
          enabled: true
        },
        {
          id: 'sugar-flakes',
          type: 'sprinkles',
          color: '#ffffff',
          secondaryColor: '#ffe0f0',
          scale: 0.8,
          enabled: true
        }
      ]
    },
    face: {
      style: 'kawaii-happy',
      eyeColor: '#3a2238',
      blushColor: '#ff5c93',
      blushIntensity: 0.85,
      scale: 0.95,
      offsetY: -0.08,
      reactiveToSquish: true
    },
    audio: {
      profile: 'taba-jelly',
      pitch: 1.08,
      volume: 0.8
    }
  },
  {
    id: 'kawaii-peach',
    name: 'Pêche Royale Slow-Rising',
    subtitle: 'Mousse Mémoire de Forme 6s',
    description:
      'Le grand classique des squishies japonais : une pêche charnue au dégradé rose-corail velouté qui met plusieurs secondes à reprendre sa forme après un gros écrasement.',
    category: 'Slow-Rising Classique',
    badge: '🍑 Slow-Rise 6s',
    popularityScore: 96,
    geometry: {
      shape: 'peach',
      scale: { x: 1.05, y: 1.08, z: 1.02 },
      roundness: 0.95,
      subdivisions: 72
    },
    physics: {
      softness: 0.88,
      recoverySpeed: 0.11,
      viscosity: 0.91,
      poissonRatio: 0.42,
      squeezeRadius: 1.05,
      wobbleIntensity: 0.14,
      stickiness: 0.25
    },
    material: {
      primaryColor: '#ff7597',
      secondaryColor: '#ffe5b4',
      accentColor: '#7ed957',
      gradientStrength: 0.85,
      finish: 'matte-foam',
      roughness: 0.58,
      clearcoat: 0.22,
      transmission: 0.05,
      toppings: [
        {
          id: 'peach-leaf',
          type: 'leaf',
          color: '#68d391',
          secondaryColor: '#38a169',
          scale: 1.0,
          enabled: true
        }
      ]
    },
    face: {
      style: 'sleepy-zen',
      eyeColor: '#2d1b2e',
      blushColor: '#ff3b6b',
      blushIntensity: 0.9,
      scale: 1.05,
      offsetY: 0.02,
      reactiveToSquish: true
    },
    audio: {
      profile: 'foam-slow',
      pitch: 0.92,
      volume: 0.85
    }
  },
  {
    id: 'strawberry-milk-box',
    name: 'Brique Lait Fraise',
    subtitle: 'Brique Kawaii Harajuku',
    description:
      'Une brique de lait à la fraise pastel avec ses arêtes moelleuses et sa paille : idéale pour écraser les coins et regarder la mousse se regonfler doucement.',
    category: 'Slow-Rising Classique',
    badge: '🍓 Best-Seller',
    popularityScore: 94,
    geometry: {
      shape: 'milk-box',
      scale: { x: 0.92, y: 1.18, z: 0.88 },
      roundness: 0.65,
      subdivisions: 64
    },
    physics: {
      softness: 0.82,
      recoverySpeed: 0.14,
      viscosity: 0.88,
      poissonRatio: 0.38,
      squeezeRadius: 0.92,
      wobbleIntensity: 0.18,
      stickiness: 0.2
    },
    material: {
      primaryColor: '#ff8fb1',
      secondaryColor: '#fff8fb',
      accentColor: '#ff477e',
      gradientStrength: 0.7,
      finish: 'matte-foam',
      roughness: 0.52,
      clearcoat: 0.28,
      transmission: 0.04,
      toppings: [
        {
          id: 'milk-straw',
          type: 'straw',
          color: '#ff5c8a',
          secondaryColor: '#ffffff',
          scale: 1.0,
          enabled: true
        }
      ]
    },
    face: {
      style: 'starry-eyed',
      eyeColor: '#2b192e',
      blushColor: '#ff477e',
      blushIntensity: 0.8,
      scale: 1.0,
      offsetY: -0.05,
      reactiveToSquish: true
    },
    audio: {
      profile: 'foam-slow',
      pitch: 1.0,
      volume: 0.8
    }
  },
  {
    id: 'sakura-mochi-bunny',
    name: 'Lapin Mochi Sakura',
    subtitle: 'Toucher Poudré & Oreilles Souples',
    description:
      'Un petit lapin mochi tout rond à la texture poudrée de farine de riz, ultra-doux à tapoter et pétrir du bout des doigts.',
    category: 'Mochi & Kawaii',
    badge: '🐰 Ultra Doux',
    popularityScore: 93,
    geometry: {
      shape: 'mochi-bunny',
      scale: { x: 1.06, y: 0.96, z: 1.06 },
      roundness: 0.96,
      subdivisions: 72
    },
    physics: {
      softness: 0.94,
      recoverySpeed: 0.32,
      viscosity: 0.68,
      poissonRatio: 0.52,
      squeezeRadius: 0.88,
      wobbleIntensity: 0.54,
      stickiness: 0.48
    },
    material: {
      primaryColor: '#ffdde8',
      secondaryColor: '#ffffff',
      accentColor: '#ff85a9',
      gradientStrength: 0.6,
      finish: 'velvet-mochi',
      roughness: 0.68,
      clearcoat: 0.15,
      transmission: 0.25,
      toppings: [
        {
          id: 'bunny-blush-hearts',
          type: 'blush-hearts',
          color: '#ff6b9d',
          scale: 1.0,
          enabled: true
        }
      ]
    },
    face: {
      style: 'kawaii-happy',
      eyeColor: '#3b1f2b',
      blushColor: '#ff7096',
      blushIntensity: 0.92,
      scale: 1.05,
      offsetY: -0.04,
      reactiveToSquish: true
    },
    audio: {
      profile: 'mochi-puff',
      pitch: 1.22,
      volume: 0.78
    }
  },
  {
    id: 'brown-sugar-boba',
    name: 'Boba Tea Perlé',
    subtitle: 'Crème Fouettée & Perles Tapioca',
    description:
      'Un bubble tea gourmand avec dôme chantilly moelleux, perles de tapioca au fond et paille XXL à presser dans tous les sens.',
    category: 'Foodie Pop',
    badge: '🧋 ASMR Pop',
    popularityScore: 91,
    geometry: {
      shape: 'boba-cup',
      scale: { x: 0.95, y: 1.15, z: 0.95 },
      roundness: 0.78,
      subdivisions: 64
    },
    physics: {
      softness: 0.85,
      recoverySpeed: 0.19,
      viscosity: 0.82,
      poissonRatio: 0.41,
      squeezeRadius: 0.92,
      wobbleIntensity: 0.32,
      stickiness: 0.38
    },
    material: {
      primaryColor: '#f6d5b0',
      secondaryColor: '#fff9f2',
      accentColor: '#6f4226',
      gradientStrength: 0.75,
      finish: 'pearlescent',
      roughness: 0.32,
      clearcoat: 0.68,
      transmission: 0.18,
      toppings: [
        {
          id: 'boba-pearls',
          type: 'pearl-boba',
          color: '#3d2214',
          secondaryColor: '#5c3420',
          scale: 1.0,
          enabled: true
        },
        {
          id: 'boba-straw',
          type: 'straw',
          color: '#ff7597',
          secondaryColor: '#fff0f5',
          scale: 1.1,
          enabled: true
        }
      ]
    },
    face: {
      style: 'cheeky-wink',
      eyeColor: '#362013',
      blushColor: '#ff8da1',
      blushIntensity: 0.78,
      scale: 0.98,
      offsetY: 0.04,
      reactiveToSquish: true
    },
    audio: {
      profile: 'taba-jelly',
      pitch: 0.96,
      volume: 0.82
    }
  },
  {
    id: 'galaxy-unicorn-donut',
    name: 'Donut Licorne Glacé',
    subtitle: 'Glaçage Nacré & Vermicelles',
    description:
      'Un donut dodu recouvert d’un glaçage pastel irisé et de vermicelles croquants, avec une mousse slow-rising ultra-satisfaisante.',
    category: 'Foodie Pop',
    badge: '🍩 Glaçage Nacré',
    popularityScore: 90,
    geometry: {
      shape: 'donut',
      scale: { x: 1.1, y: 0.85, z: 1.1 },
      roundness: 0.9,
      subdivisions: 68
    },
    physics: {
      softness: 0.86,
      recoverySpeed: 0.16,
      viscosity: 0.85,
      poissonRatio: 0.44,
      squeezeRadius: 0.95,
      wobbleIntensity: 0.25,
      stickiness: 0.35
    },
    material: {
      primaryColor: '#c8b6ff',
      secondaryColor: '#ffafcc',
      accentColor: '#fde4cf',
      gradientStrength: 0.8,
      finish: 'sugar-coated',
      roughness: 0.36,
      clearcoat: 0.75,
      transmission: 0.12,
      toppings: [
        {
          id: 'donut-sprinkles',
          type: 'sprinkles',
          color: '#ffef9f',
          secondaryColor: '#90dbf4',
          scale: 1.0,
          enabled: true
        }
      ]
    },
    face: {
      style: 'kawaii-happy',
      eyeColor: '#2b1e3d',
      blushColor: '#ff6392',
      blushIntensity: 0.82,
      scale: 0.9,
      offsetY: 0.0,
      reactiveToSquish: true
    },
    audio: {
      profile: 'crispy-sugar',
      pitch: 1.05,
      volume: 0.8
    }
  }
];

export class SquishyCatalog {
  private static instances: Map<string, Squishy> = new Map();

  static getAll(): Squishy[] {
    if (this.instances.size === 0) {
      for (const cfg of POPULAR_SQUISHY_CONFIGS) {
        this.instances.set(cfg.id, new Squishy(cfg));
      }
    }
    return Array.from(this.instances.values());
  }

  static getById(id: string): Squishy | undefined {
    if (this.instances.size === 0) {
      this.getAll();
    }
    return this.instances.get(id);
  }

  static registerCustom(squishy: Squishy): void {
    this.getAll();
    this.instances.set(squishy.id, squishy);
  }
}

