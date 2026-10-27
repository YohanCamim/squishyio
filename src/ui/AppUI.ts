import type { ISquishyStage3D } from "../core/engineContract";
import { Squishy, SquishyBuilder } from "../core/Squishy";
import { SquishyCatalog } from "../models/popularSquishies";
import type {
  InteractionMode,
  SquishyFaceStyle,
  SquishyFinishType
} from "../core/types";

interface SliderSpec {
  key: "softness" | "recoverySpeed" | "poissonRatio" | "wobbleIntensity";
  label: string;
  min: number;
  max: number;
}

const PHYSICS_SLIDERS: SliderSpec[] = [
  { key: "softness", label: "Souplesse", min: 0.15, max: 1.0 },
  { key: "recoverySpeed", label: "Vitesse Slow-Rising", min: 0.04, max: 0.85 },
  { key: "poissonRatio", label: "Gonflement latéral", min: 0.05, max: 0.75 },
  { key: "wobbleIntensity", label: "Rebond Jelly", min: 0.0, max: 1.0 }
];

const FINISHES: { value: SquishyFinishType; label: string }[] = [
  { value: "glossy-jelly", label: "Glossy Jelly" },
  { value: "matte-foam", label: "Matte Foam" },
  { value: "velvet-mochi", label: "Velvet Mochi" },
  { value: "pearlescent", label: "Pearlescent" },
  { value: "sugar-coated", label: "Sugar Coated" }
];

const FACES: { value: SquishyFaceStyle; label: string }[] = [
  { value: "kawaii-happy", label: "😊 Kawaii" },
  { value: "sleepy-zen", label: "😌 Zen" },
  { value: "starry-eyed", label: "🤩 Étoiles" },
  { value: "cheeky-wink", label: "😉 Clin d’œil" },
  { value: "none", label: "Aucun" }
];

const MODES: { value: InteractionMode; label: string }[] = [
  { value: "poke", label: "👆 Presser" },
  { value: "squeeze", label: "✊ Écraser" },
  { value: "knead", label: "🫳 Pétrir" },
  { value: "slap", label: "👋 Tapoter" }
];

/** Emoji d'aperçu par forme (pilules du dock) */
const SHAPE_EMOJI: Record<string, string> = {
  butter: "🧈",
  "cat-paw": "🐾",
  peach: "🍑",
  "milk-box": "🍓",
  "mochi-bunny": "🐰",
  "boba-cup": "🧋",
  donut: "🍩"
};

export class AppUI {
  private stage: ISquishyStage3D;
  private squishy: Squishy;
  private unsubscribe: () => void;

  private muteBtn!: HTMLButtonElement;
  private megaBtn!: HTMLButtonElement;
  private riseFill!: HTMLElement;
  private riseState!: HTMLElement;
  private drawer!: HTMLElement;
  private drawerBody!: HTMLElement;
  private squishyPills!: HTMLElement;
  private toastEl: HTMLElement | null = null;
  private toastTimer: number | undefined;
  private labControlsBuiltFor = "";
  private selectedCardId = "";

  constructor(stage: ISquishyStage3D) {
    this.stage = stage;
    this.squishy = stage.getCurrentSquishy();
    this.unsubscribe = this.squishy.subscribe(() => {
      this.updateStats();
    });

    this.buildTopZone();
    this.buildBottomZone();
    this.buildDrawer();

    this.stage.setMuted(false);

    // Menus révélés pendant les 2,5 premières secondes
    const topZone = document.querySelector(".top-hover-zone")!;
    const bottomZone = document.querySelector(".bottom-hover-zone")!;
    topZone.classList.add("revealed");
    bottomZone.classList.add("revealed");
    window.setTimeout(() => {
      topZone.classList.remove("revealed");
      bottomZone.classList.remove("revealed");
    }, 2500);

    // Tap sur mobile : bascule le menu de la zone touchée
    for (const zone of [topZone, bottomZone]) {
      zone.addEventListener("click", e => {
        if ((e.target as HTMLElement).closest(".menu-content")) return;
        const wasOpen = zone.classList.contains("revealed");
        topZone.classList.remove("revealed");
        bottomZone.classList.remove("revealed");
        if (!wasOpen) zone.classList.add("revealed");
      });
    }

    window.addEventListener("keydown", e => {
      if (
        e.code === "Space" &&
        !(e.target as HTMLElement)?.matches("input, textarea, select")
      ) {
        e.preventDefault();
        this.megaSquish();
      }
      if (e.code === "Escape") this.drawer.classList.remove("open");
      if (e.key.toLowerCase() === "l" && !e.metaKey && !e.ctrlKey)
        this.toggleDrawer();
    });
  }

  /* ---------- Zone haute : peek + menu au survol ---------- */

  private buildTopZone(): void {
    const zone = document.createElement("div");
    zone.className = "hover-zone top-hover-zone";

    const peek = document.createElement("button");
    peek.className = "peek";
    peek.textContent = "squishy.io • ▾";
    peek.tabIndex = -1;

    const menu = document.createElement("div");
    menu.className = "menu-content";

    const bar = document.createElement("div");
    bar.className = "hud-header";
    bar.innerHTML = `
      <div class="logo">squishy<span class="dot">.ia</span></div>
      <div class="rise-indicator">
        <span class="rise-track"><span class="rise-fill"></span></span>
        <span class="rise-state">0%</span>
      </div>
      <div class="header-actions">
        <button class="mega-btn" data-action="mega" title="Mega Squish (barre Espace)">💥 Mega Squish</button>
        <button class="icon-btn" data-action="mute" title="Couper / activer le son">🔊</button>
        <button class="btn-lab" data-action="lab">⚙️ Personnaliser</button>
      </div>`;

    this.riseFill = bar.querySelector(".rise-fill")!;
    this.riseState = bar.querySelector(".rise-state")!;
    this.muteBtn = bar.querySelector('[data-action="mute"]')!;
    this.megaBtn = bar.querySelector('[data-action="mega"]')!;

    this.muteBtn.addEventListener("click", () => {
      const muted = !this.stage.isMuted();
      this.stage.setMuted(muted);
      this.muteBtn.textContent = muted ? "🔇" : "🔊";
    });
    this.megaBtn.addEventListener("click", () => this.megaSquish());
    bar
      .querySelector('[data-action="lab"]')!
      .addEventListener("click", () => this.toggleDrawer());

    menu.appendChild(bar);
    zone.appendChild(menu);
    zone.appendChild(peek);
    this.mount(zone);
  }

  /* ---------- Zone basse : peek + menu au survol ---------- */

  private buildBottomZone(): void {
    const zone = document.createElement("div");
    zone.className = "hover-zone bottom-hover-zone";

    const peek = document.createElement("button");
    peek.className = "peek";
    peek.textContent = "🧈 Modèles & Outils • ▴";
    peek.tabIndex = -1;

    const menu = document.createElement("div");
    menu.className = "menu-content";

    // Rangée 1 : pilules de sélection des squishies
    this.squishyPills = document.createElement("div");
    this.squishyPills.className = "dock-row";
    this.renderPills();
    menu.appendChild(this.squishyPills);

    // Rangée 2 : modes d'interaction + reset forme
    const modeRow = document.createElement("div");
    modeRow.className = "dock-row";
    for (const mode of MODES) {
      const btn = document.createElement("button");
      btn.className =
        "pill" +
        (mode.value === this.stage.getInteractionMode() ? " active" : "");
      btn.textContent = mode.label;
      btn.addEventListener("click", () => {
        this.stage.setInteractionMode(mode.value);
        modeRow
          .querySelectorAll(".pill")
          .forEach(b => b.classList.toggle("active", b === btn));
      });
      modeRow.appendChild(btn);
    }
    const resetBtn = document.createElement("button");
    resetBtn.className = "pill";
    resetBtn.textContent = "↺ Reset forme";
    resetBtn.title = "Revenir instantanément à la forme au repos";
    resetBtn.addEventListener("click", () => {
      this.stage.resetDeformationImmediate();
      this.showToast("Forme réinitialisée");
    });
    modeRow.appendChild(resetBtn);
    menu.appendChild(modeRow);

    const hint = document.createElement("div");
    hint.className = "dock-hint";
    hint.textContent =
      "Glisser autour pour tourner à 360° • Cliquer sur le squishy pour presser";
    menu.appendChild(hint);

    zone.appendChild(menu);
    zone.appendChild(peek);
    this.mount(zone);
  }

  private renderPills(): void {
    this.squishyPills.innerHTML = "";
    for (const squishy of SquishyCatalog.getAll()) {
      const cfg = squishy.toConfig();
      const pill = document.createElement("button");
      pill.className =
        "pill" + (squishy.id === this.selectedCardId ? " active" : "");
      pill.innerHTML = `<span class="pill-dot" style="background:linear-gradient(140deg, ${cfg.material.primaryColor}, ${cfg.material.secondaryColor})"></span><span class="pill-emoji">${SHAPE_EMOJI[cfg.geometry.shape] ?? "🧸"}</span>${squishy.name}`;
      pill.title = `${squishy.name} — ${squishy.subtitle}`;
      pill.addEventListener("click", () => this.selectSquishy(squishy));
      this.squishyPills.appendChild(pill);
    }
  }

  /* ---------- Tiroir Squishy Lab (caché par défaut) ---------- */

  private buildDrawer(): void {
    this.drawer = document.createElement("aside");
    this.drawer.className = "drawer";
    this.drawer.innerHTML = `
      <div class="drawer-head">
        <div>
          <h2>Squishy Lab</h2>
          <p>Propriétés modulables & preview créateur</p>
        </div>
        <button class="icon-btn" data-action="close" title="Fermer (Échap)">✕</button>
      </div>
      <div class="drawer-body"></div>`;
    this.drawerBody = this.drawer.querySelector(".drawer-body")!;
    this.drawer
      .querySelector('[data-action="close"]')!
      .addEventListener("click", () => this.drawer.classList.remove("open"));
    this.mount(this.drawer);
    this.buildLabControls();
  }

  private toggleDrawer(): void {
    this.drawer.classList.toggle("open");
  }

  /* ---------- Contrôles du Lab ---------- */

  private buildLabControls(): void {
    if (this.labControlsBuiltFor === this.squishy.id) return;
    this.labControlsBuiltFor = this.squishy.id;
    const body = this.drawerBody;
    body.innerHTML = "";
    const s = this.squishy;

    // --- Physique ---
    const phys = this.section("Physique Slow-Rising");
    for (const spec of PHYSICS_SLIDERS) {
      const row = document.createElement("div");
      row.className = "slider-row";
      const val = s.physics[spec.key];
      row.innerHTML = `
        <label>${spec.label} <output>${val.toFixed(2)}</output></label>
        <input type="range" min="${spec.min}" max="${spec.max}" step="0.01" value="${val}" />`;
      const input = row.querySelector("input") as HTMLInputElement;
      const out = row.querySelector("output")!;
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        out.textContent = v.toFixed(2);
        this.squishy.updatePhysics({ [spec.key]: v });
      });
      phys.appendChild(row);
    }
    body.appendChild(phys);

    // --- Matériau ---
    const mat = this.section("Matériau & Couleurs");
    for (const [key, label] of [
      ["primaryColor", "Couleur principale"],
      ["secondaryColor", "Couleur secondaire"]
    ] as const) {
      const row = document.createElement("div");
      row.className = "color-row";
      row.innerHTML = `<label>${label}</label>`;
      const color = document.createElement("input");
      color.type = "color";
      color.value = s.material[key];
      color.addEventListener("input", () =>
        this.squishy.updateMaterial({ [key]: color.value })
      );
      row.appendChild(color);
      mat.appendChild(row);
    }

    const finishRow = document.createElement("div");
    finishRow.className = "chip-row";
    for (const f of FINISHES) {
      const chip = document.createElement("button");
      chip.className =
        "chip" + (s.material.finish === f.value ? " active" : "");
      chip.textContent = f.label;
      chip.addEventListener("click", () => {
        this.squishy.updateMaterial({ finish: f.value });
        finishRow
          .querySelectorAll(".chip")
          .forEach(c => c.classList.toggle("active", c === chip));
      });
      finishRow.appendChild(chip);
    }
    mat.appendChild(finishRow);

    if (s.material.toppings.length > 0) {
      const topTitle = document.createElement("h3");
      topTitle.textContent = "Toppings";
      topTitle.style.cssText =
        "font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:var(--text-faint);margin:14px 0 8px;";
      mat.appendChild(topTitle);
      for (const topping of s.material.toppings) {
        const row = document.createElement("div");
        row.className = "toggle-row" + (topping.enabled ? "" : " off");
        row.innerHTML = `<span>${topping.id}</span>`;
        const tgl = document.createElement("button");
        tgl.className = "toggle-btn" + (topping.enabled ? " on" : "");
        tgl.addEventListener("click", () => {
          const on = !topping.enabled;
          this.squishy.toggleTopping(topping.id, on);
          tgl.classList.toggle("on", on);
          row.classList.toggle("off", !on);
        });
        row.appendChild(tgl);
        mat.appendChild(row);
      }
    }
    body.appendChild(mat);

    // --- Visage ---
    const face = this.section("Expression");
    const faceRow = document.createElement("div");
    faceRow.className = "chip-row";
    for (const f of FACES) {
      const chip = document.createElement("button");
      chip.className = "chip" + (s.face.style === f.value ? " active" : "");
      chip.textContent = f.label;
      chip.addEventListener("click", () => {
        this.squishy.updateFace({ style: f.value });
        faceRow
          .querySelectorAll(".chip")
          .forEach(c => c.classList.toggle("active", c === chip));
      });
      faceRow.appendChild(chip);
    }
    face.appendChild(faceRow);
    body.appendChild(face);

    // --- Actions ---
    const actions = this.section("Actions");
    actions.innerHTML = `
      <div class="lab-actions">
        <button class="lab-btn" data-act="clone">🧬 Cloner en Squishy Custom</button>
        <button class="lab-btn" data-act="export">📋 Exporter JSON Blueprint</button>
        <button class="lab-btn" data-act="reset">↺ Réinitialiser le modèle</button>
      </div>`;
    actions
      .querySelector('[data-act="clone"]')!
      .addEventListener("click", () => {
        const n = SquishyCatalog.getAll().filter(x => x.isCustom).length + 1;
        const built = new SquishyBuilder(this.squishy)
          .setIdentity(
            `Mon Custom #${n}`,
            "Clone du Squishy Lab",
            `Clone personnalisé de ${this.squishy.name}.`
          )
          .build();
        SquishyCatalog.registerCustom(built);
        this.selectSquishy(built);
        this.showToast(`« ${built.name} » ajouté à la barre de sélection`);
      });
    actions
      .querySelector('[data-act="export"]')!
      .addEventListener("click", () => {
        const json = this.squishy.toJSON();
        navigator.clipboard?.writeText(json).catch(() => {});
        const blob = new Blob([json], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${this.squishy.id}-blueprint.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.showToast("Blueprint JSON exporté");
      });
    actions
      .querySelector('[data-act="reset"]')!
      .addEventListener("click", () => {
        this.squishy.resetToPresetDefaults();
        this.stage.resetDeformationImmediate();
        this.showToast("Modèle réinitialisé");
      });
    body.appendChild(actions);
  }

  private section(title: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "lab-section";
    const h = document.createElement("h3");
    h.textContent = title;
    el.appendChild(h);
    return el;
  }

  /* ---------- Logique temps réel ---------- */

  private selectSquishy(squishy: Squishy): void {
    if (squishy.id === this.squishy.id && this.selectedCardId === squishy.id)
      return;
    this.unsubscribe();
    this.squishy = squishy;
    this.unsubscribe = squishy.subscribe(() => this.updateStats());
    this.selectedCardId = squishy.id;
    this.stage.loadSquishy(squishy);
    this.labControlsBuiltFor = "";
    this.buildLabControls();
    this.renderPills();
    this.showToast(`${squishy.name} sélectionné`);
  }

  private megaSquish(): void {
    this.stage.triggerMegaSquish(1.0);
    this.megaBtn.classList.add("slammed");
    window.setTimeout(() => this.megaBtn.classList.remove("slammed"), 220);
  }

  private updateStats(): void {
    const st = this.squishy.state;
    const pct = Math.round(st.currentCompression * 100);
    this.riseFill.style.width = `${pct}%`;
    this.riseState.textContent = `${pct}%`;
    this.riseState.title = st.isPressed
      ? "En compression"
      : st.isRecovering
        ? "Reprise de forme lente"
        : `Prêt à presser · reprise estimée ${this.squishy.estimatedRiseTimeSeconds.toFixed(1)}s`;
  }

  private showToast(message: string): void {
    if (!this.toastEl) {
      this.toastEl = document.createElement("div");
      this.toastEl.className = "toast";
      this.mount(this.toastEl);
    }
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(
      () => this.toastEl!.classList.remove("show"),
      2200
    );
  }

  /** Boucle d'UI légère : indicateur de compression en continu */
  startTick(): void {
    const loop = () => {
      this.updateStats();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private mount(el: HTMLElement): void {
    document.getElementById("app")!.appendChild(el);
  }

  dispose(): void {
    this.unsubscribe();
  }
}
