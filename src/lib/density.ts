// Pressure and density altitude using the PHAK (FAA-H-8083-25, ch. 4 and 11)
// rules of thumb, which is also what the knowledge test expects.

export function pressureAltitudeFt(fieldElevFt: number, altimeterInHg: number): number {
  return fieldElevFt + (29.92 - altimeterInHg) * 1000;
}

export function isaTempC(pressureAltFt: number): number {
  return 15 - (2 * pressureAltFt) / 1000;
}

export function densityAltitudeFt(fieldElevFt: number, altimeterInHg: number, oatC: number): number {
  const pa = pressureAltitudeFt(fieldElevFt, altimeterInHg);
  return pa + 120 * (oatC - isaTempC(pa));
}
