// Tofu (modified 2026-10-25, 2026-10-30): builds with @sveltejs/adapter-vercel by default, which is what Tofu's SvelteKit
// hosting runs. Set CACTOIDE_ADAPTER=node to build the standalone Node server instead (upstream's adapter); the Dockerfile does.
// The function runtime is named (nodejs24.x): adapter-vercel 6.3.4 takes the Node major the build runs on as the runtime
// and throws for any major but 20, 22 and 24, and Vercel's default for a new project has been Node 26 since 2026-10-29.
import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const useNode = process.env.CACTOIDE_ADAPTER === 'node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		adapter: useNode
			? adapterNode({
					// if you want to use 'split' mode, set this to 'split'
					// and create a _redirects file with the redirects you want
					// see "split" mode in https://github.com/sveltejs/kit/tree/main/packages/adapter-netlify
					edge: false,
					split: false
				})
			: adapterVercel({ runtime: 'nodejs24.x' })
	}
};

export default config;
