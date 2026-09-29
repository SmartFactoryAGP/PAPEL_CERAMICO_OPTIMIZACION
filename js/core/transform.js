/* Rota/refleja los puntos SIN volver a llevar el origen a (0,0) — la usa
   transformPoly (abajo) para la pieza, y buildOrientations (Bloque 4) para
   alinear las líneas de grabado exactamente con la misma rotación. */
function rotateRaw(pts, deg, mirror){
  const r=deg*Math.PI/180, c=Math.cos(r), s=Math.sin(r);
  return pts.map(([x,y])=>{
    const mx = mirror ? -x : x;
    return [mx*c - y*s, mx*s + y*c];
  });
}
function transformPoly(pts, deg, mirror){
  const out = rotateRaw(pts, deg, mirror);
  const bb = polyBBox(out);
  return out.map(([x,y])=>[x-bb.minx, y-bb.miny]);
}
