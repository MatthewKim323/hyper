self.addEventListener('message', event => {
	const { id, url } = event.data;
	fetch(url)
	.then(response => {
		if (!response.ok) {
			throw new Error('Network response was not ok');
		}
		return response.blob();
	})
	.then(blob => {
		self.postMessage({ id, blob });
	})
	.catch(error => {
		self.postMessage({ id, error: error.toString() });
	});
});