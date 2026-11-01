// Presentation only: room invitations and returns to the menu skip the intro.
const opening=document.querySelector('#opening');
const shell=document.querySelector('.shell');
const play=document.querySelector('#opening-play');
let dismissed=false;
let alreadySeen=false;
try{alreadySeen=sessionStorage.getItem('wall-rush-opening-seen')==='1';}catch{}
const skip=alreadySeen||new URLSearchParams(location.search).has('room');
function finish(){
  opening.hidden=true;
  shell.inert=false;
  document.body.classList.remove('opening-active');
}
if(skip){finish();}else{
  document.body.classList.add('opening-active');
  shell.inert=true;
  play.focus({preventScroll:true});
  play.addEventListener('click',()=>{
    if(dismissed)return;
    dismissed=true;
    try{sessionStorage.setItem('wall-rush-opening-seen','1');}catch{}
    opening.classList.add('opening-leaving');
    // Timeout also completes the transition when animations are disabled.
    setTimeout(()=>{finish();document.querySelector('#join-code').focus({preventScroll:true});},
      matchMedia('(prefers-reduced-motion: reduce)').matches?0:650);
  });
}
