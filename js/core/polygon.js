function polyArea(pts){
  let a=0;
  for(let i=0;i<pts.length;i++){
    const [x1,y1]=pts[i], [x2,y2]=pts[(i+1)%pts.length];
    a += x1*y2 - x2*y1;
  }
  return Math.abs(a)/2;
}
function polyPerimeter(pts){
  let p=0;
  for(let i=0;i<pts.length;i++){
    const [x1,y1]=pts[i], [x2,y2]=pts[(i+1)%pts.length];
    p += Math.hypot(x2-x1,y2-y1);
  }
  return p;
}
function normalize(pts){
  const bb = polyBBox(pts);
  return pts.map(([x,y])=>[Number((x-bb.minx).toFixed(3)), Number((y-bb.miny).toFixed(3))]);
}
/* simplifica el contorno (Douglas-Peucker) para acelerar pip/dist */
function simplify(pts, tol){
  if(pts.length<=4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0]=1; keep[pts.length-1]=1;
  const stack=[[0,pts.length-1]];
  while(stack.length){
    const [a,b]=stack.pop();
    let maxD=-1, idx=-1;
    const [x1,y1]=pts[a],[x2,y2]=pts[b];
    for(let i=a+1;i<b;i++){
      const d = distPointSeg(pts[i][0],pts[i][1],x1,y1,x2,y2);
      if(d>maxD){maxD=d;idx=i;}
    }
    if(maxD>tol && idx>0){ keep[idx]=1; stack.push([a,idx],[idx,b]); }
  }
  const out=[];
  for(let i=0;i<pts.length;i++) if(keep[i]) out.push(pts[i]);
  return out.length>=3?out:pts;
}

/* =========================================================
   PARSER DXF MÍNIMO
   ========================================================= */
