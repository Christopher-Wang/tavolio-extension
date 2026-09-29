import type { TavolioModel } from "./types.js";

export class ModelRegistry {
  private models = new Map<string, TavolioModel>();

  register(model: TavolioModel): void {
    this.models.set(model.manifest.id, model);
  }

  get(id: string): TavolioModel {
    const m = this.models.get(id);
    if (!m) throw new Error(`Unknown model: ${id}. Registered: ${[...this.models.keys()].join(", ")}`);
    return m;
  }

  list(): TavolioModel[] {
    return [...this.models.values()];
  }
}

export const modelRegistry = new ModelRegistry();
