/**
 * Un toque corto del motor del teléfono.
 *
 * **En iPhone no hace nada**: Safari no implementa `navigator.vibrate`, ni
 * siquiera con la app instalada como PWA. No es un fallo que se pueda tapar
 * desde aquí; por eso todo lo que vibra lleva además su animación, que es lo
 * único que ven los de iPhone.
 */
export function vibrar(patron: number | number[]) {
  try {
    navigator.vibrate?.(patron)
  } catch {
    // Algunos navegadores lo tienen pero lo rechazan sin interacción previa.
  }
}
