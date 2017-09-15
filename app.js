if ('serviceWorker' in navigator){
	navigator.serviceWorker.register('sw.js');
}
document.querySelector('#boton').addEventListener('click', () => {
	alert("click");
});
