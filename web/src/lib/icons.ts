import {
  Briefcase,
  Drill,
  Grid3x3,
  Hammer,
  House,
  Layers,
  PaintRoller,
  Shovel,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-vue-next';

// Branches leveren een lucide-naam aan; onbekende namen krijgen een koffertje.
const icons: Record<string, LucideIcon> = {
  'paint-roller': PaintRoller,
  layers: Layers,
  hammer: Hammer,
  shovel: Shovel,
  wrench: Wrench,
  zap: Zap,
  'grid-3x3': Grid3x3,
  house: House,
  drill: Drill,
  briefcase: Briefcase,
};

export const iconFor = (name: string): LucideIcon => icons[name] ?? Briefcase;
