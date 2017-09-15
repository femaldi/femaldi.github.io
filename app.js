if ('serviceWorker' in navigator){
	navigator.serviceWorker.register('sw.js').then(reg => reg.update());
}
document.querySelector('#boton').addEventListener('click', () => {
	alert("click");
});
