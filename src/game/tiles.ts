/**
 * Tipos y utilidades de fichas compartidos por la UI.
 * OJO: la autoridad de las reglas vive en Postgres (funciones SECURITY DEFINER).
 * Lo de aquí es solo para pintar y para deshabilitar lo que no se puede tocar;
 * el servidor revalida absolutamente todo.
 */

export type Pip = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type Side = 'l' | 'r'

/** Ficha en formato canónico "mayor-menor", como se guarda en la DB. Ej: "6-4". */
export type Tile = string

export function makeTile(a: number, b: number): Tile {
  return a >= b ? `${a}-${b}` : `${b}-${a}`
}

export function parseTile(tile: Tile): [Pip, Pip] {
  const [a, b] = tile.split('-').map(Number)
  return [a as Pip, b as Pip]
}

export function isDouble(tile: Tile): boolean {
  const [a, b] = parseTile(tile)
  return a === b
}

export function pips(tile: Tile): number {
  const [a, b] = parseTile(tile)
  return a + b
}

export function totalPips(tiles: Tile[]): number {
  return tiles.reduce((sum, t) => sum + pips(t), 0)
}

/** El juego de dobles completo: 28 fichas, del 0-0 al 6-6. */
export function fullSet(): Tile[] {
  const out: Tile[] = []
  for (let a = 0; a <= 6; a++) for (let b = 0; b <= a; b++) out.push(makeTile(a, b))
  return out
}

/** Extremos donde calza una ficha. Tablero vacío ⇒ calza por la derecha (es la salida). */
export function playableSides(tile: Tile, left: Pip | null, right: Pip | null): Side[] {
  if (left === null || right === null) return ['r']
  const [a, b] = parseTile(tile)
  const sides: Side[] = []
  if (a === left || b === left) sides.push('l')
  if (a === right || b === right) sides.push('r')
  return sides
}

export function hasAnyPlay(hand: Tile[], left: Pip | null, right: Pip | null): boolean {
  return hand.some((t) => playableSides(t, left, right).length > 0)
}
