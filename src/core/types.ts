/**
 * Architecture Core Types — squishy.io
 * Conçu pour supporter à la fois les modèles populaires pré-configurés
 * et le futur Créateur/Éditeur de Squishy (sérialisation JSON, mutation à chaud).
 */

export type SquishyShapeType =
  | "cat-paw" // Taba Squishy Patte de Chat (viral TikTok)
  | "peach" // Pêche Kawaii Slow-Rising
  | "milk-box" // Brique de Lait Fraise
  | "mochi-bunny" // Lapin Mochi Sakura
  | "boba-cup" // Bubble Tea Perlé
  | "donut" // Donut Glacé Licorne
  | "butter"; // Plaquette de Beurre Fondant

export type SquishyFinishType =
  | "glossy-jelly" // Taba squishy translucide et brillant (effet mochi/gel)
  | "matte-foam" // Mousse polyuréthane slow-rising classique
  | "velvet-mochi" // Toucher poudré ultra-doux
  | "pearlescent" // Nacré / irisé
  | "sugar-coated"; // Enrobé de sucre / paillettes

export type SquishyFaceStyle =
  | "kawaii-happy"
  | "sleepy-zen"
  | "starry-eyed"
  | "cheeky-wink"
  | "none";

export type SquishyAudioProfile =
  | "foam-slow" // Souffle d'air étouffé de mousse mémoire de forme
  | "taba-jelly" // Bruit gluant/doux de gel silicone Taba
  | "mochi-puff" // Son sourd et poudré
  | "crispy-sugar"; // Léger crépitement + mousse

export type InteractionMode =
  | "poke" // Presser avec un doigt (localisé)
  | "squeeze" // Écraser à pleine main (compression globale + gonflement)
  | "knead" // Pétrir / malaxer en glissant
  | "slap"; // Tapoter (rebond élastique)

export interface SquishyGeometryProps {
  shape: SquishyShapeType;
  scale: { x: number; y: number; z: number };
  roundness: number; // 0.1 à 1.0
  subdivisions: number; // Finesse du maillage pour la déformation
}

export interface SquishyPhysicsProps {
  /** Souplesse (0.2 = ferme, 1.0 = ultra-mou) */
  softness: number;
  /** Vitesse de reprise de forme (0.05 = ultra slow-rising 6s, 0.85 = rebond immédiat) */
  recoverySpeed: number;
  /** Viscosité / amortissement interne (évite les oscillations infinies sur la mousse) */
  viscosity: number;
  /** Coefficient de Poisson : gonflement latéral quand on écrase (conservation du volume) */
  poissonRatio: number;
  /** Rayon d'influence d'une pression locale (0.3 à 1.6) */
  squeezeRadius: number;
  /** Intensité du tremblement "jelly" au relâchement (0.0 = mousse pure, 1.0 = gelée) */
  wobbleIntensity: number;
  /** Collant de surface / adhérence au doigt (typique des Taba Squishies) */
  stickiness: number;
}

export interface SquishyTopping {
  id: string;
  type:
    | "sprinkles"
    | "pearl-boba"
    | "straw"
    | "cat-beans"
    | "leaf"
    | "icing-drip"
    | "blush-hearts"
    | "butter-pat";
  color: string;
  secondaryColor?: string;
  scale: number;
  enabled: boolean;
}

export interface SquishyMaterialProps {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  gradientStrength: number; // 0 à 1
  finish: SquishyFinishType;
  roughness: number; // 0 à 1
  clearcoat: number; // 0 à 1
  transmission: number; // 0 à 1 (effet translucide Taba / Jelly)
  toppings: SquishyTopping[];
}

export interface SquishyFaceProps {
  style: SquishyFaceStyle;
  eyeColor: string;
  blushColor: string;
  blushIntensity: number;
  scale: number;
  offsetY: number;
  reactiveToSquish: boolean; // Change d'expression (> <) quand écrasé
}

export interface SquishyAudioProps {
  profile: SquishyAudioProfile;
  pitch: number; // 0.5 à 1.8
  volume: number; // 0 à 1
}

export interface SquishyConfig {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  category:
    | "Viral TikTok"
    | "Slow-Rising Classique"
    | "Mochi & Kawaii"
    | "Foodie Pop"
    | "Custom";
  badge?: string;
  popularityScore: number;
  geometry: SquishyGeometryProps;
  physics: SquishyPhysicsProps;
  material: SquishyMaterialProps;
  face: SquishyFaceProps;
  audio: SquishyAudioProps;
  isCustom?: boolean;
  createdAt?: string;
}

export interface SquishyRuntimeState {
  /** Niveau d'écrasement instantané (0 = repos, 1 = totalement aplati) */
  currentCompression: number;
  /** Déformation résiduelle moyenne du maillage (0 à 1) */
  residualDeformation: number;
  /** Le squishy est-il en train de reprendre lentement sa forme ? */
  isRecovering: boolean;
  /** Le squishy est-il actuellement pressé par l'utilisateur ? */
  isPressed: boolean;
  /** Nombre total de pressions sur ce squishy */
  squeezeCount: number;
  /** Score de détente / satisfaction accumulé */
  satisfactionScore: number;
}

export type SquishyChangeCategory =
  | "physics"
  | "material"
  | "geometry"
  | "face"
  | "audio"
  | "toppings"
  | "meta"
  | "state"
  | "reset";

export type SquishyChangeListener = (
  squishy: import("./Squishy").Squishy,
  category: SquishyChangeCategory
) => void;
