import type { SpeciesDef, SpeciesId } from '../types'

const defs: SpeciesDef[] = [
  {
    id: 'human',
    name: 'Humans',
    icon: '🧑‍🌾',
    color: '#e0b877',
    baseResolve: 10,
    resolveTarget: 18,
    needs: ['religion', 'luxury'],
    workBonus: { farming: 0.3, gathering: 0.15 },
    blurb: 'Steady farmhands. They want a shrine to pray at and something nice to drink.',
  },
  {
    id: 'beaver',
    name: 'Beavers',
    icon: '🦫',
    color: '#a98263',
    baseResolve: 10,
    resolveTarget: 18,
    needs: ['luxury', 'education'],
    workBonus: { woodworking: 0.4, masonry: 0.15 },
    blurb: 'Master carpenters, and insufferably particular about their comforts.',
  },
  {
    id: 'lizard',
    name: 'Lizards',
    icon: '🦎',
    color: '#7fae72',
    baseResolve: 10,
    resolveTarget: 16,
    needs: ['brawling', 'treatment'],
    workBonus: { hunting: 0.4, smithing: 0.2 },
    blurb: 'Hunters and smiths. Give them something to punch and someone to patch them up.',
  },
  {
    id: 'harpy',
    name: 'Harpies',
    icon: '🦅',
    color: '#8fa9c9',
    baseResolve: 10,
    resolveTarget: 20,
    needs: ['education', 'rest'],
    workBonus: { scholar: 0.4, gathering: 0.2 },
    blurb: 'Scholars of the old world. Prone to complaining, excellent at reading.',
  },
  {
    id: 'fox',
    name: 'Foxes',
    icon: '🦊',
    color: '#d38a5c',
    baseResolve: 10,
    resolveTarget: 18,
    needs: ['rest', 'treatment'],
    workBonus: { cooking: 0.3, gathering: 0.25 },
    blurb: 'Foragers and cooks who would rather be napping.',
  },
]

export const SPECIES: Record<SpeciesId, SpeciesDef> = Object.fromEntries(
  defs.map((d) => [d.id, d]),
) as Record<SpeciesId, SpeciesDef>

export const SPECIES_LIST = defs

export const STARTING_SPECIES: SpeciesId[] = ['human', 'beaver', 'lizard']

export const NEED_LABELS: Record<string, { name: string; icon: string }> = {
  rest: { name: 'Rest', icon: '🛌' },
  luxury: { name: 'Luxury', icon: '🍺' },
  religion: { name: 'Religion', icon: '🕯️' },
  education: { name: 'Education', icon: '📜' },
  brawling: { name: 'Brawling', icon: '🥊' },
  treatment: { name: 'Treatment', icon: '🍵' },
}

const FIRST_NAMES = [
  'Bram', 'Oda', 'Silt', 'Nessa', 'Kobb', 'Vell', 'Fenn', 'Ruk', 'Isla', 'Tamm',
  'Grell', 'Ivy', 'Dorn', 'Sable', 'Quill', 'Mott', 'Ash', 'Wren', 'Corin', 'Pell',
  'Hazel', 'Torv', 'Juno', 'Skarn', 'Lune', 'Bracken', 'Vesper', 'Halla', 'Nim', 'Osk',
]

export function villagerName(index: number): string {
  const first = FIRST_NAMES[index % FIRST_NAMES.length]
  const suffix = Math.floor(index / FIRST_NAMES.length)
  return suffix > 0 ? `${first} ${'I'.repeat(suffix + 1)}` : first
}
