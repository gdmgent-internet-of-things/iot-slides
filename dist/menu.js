let speed = 5;
let blobs = document.querySelectorAll('.blob');
blobs.forEach( (blob) => {
  blob.xspeed = Math.random()*speed;
  blob.yspeed = Math.random()*speed;
  blob.x = window.innerWidth/4;
  blob.y = window.innerHeight/4;
});

function step(timestamp) {
  
  
  blobs.forEach( (blob) => {
    blob.x+=blob.xspeed;
    blob.y+=blob.yspeed;
    checkHitBox(blob);
    blob.style = `transform: translate(${blob.x}px, ${blob.y}px)`;
  });
  window.requestAnimationFrame(step);
}

//Check for border collision
function checkHitBox(blob){
  if(blob.x + blob.clientWidth >= document.body.clientWidth || blob.x <= 0){
      blob.xspeed *= -1;
  }
  console.log(blob);
  if(blob.y + blob.clientHeight >= document.body.clientHeight || blob.y <= 0){
      blob.yspeed *= -1;
  }    
}

window.requestAnimationFrame(step);