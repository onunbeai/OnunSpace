# Higgsfield API catalog

Verified on 2026-09-26 from the official model documentation. The committed snapshot in `server/higgsfield-catalog.json` contains 81 generation endpoints: 15 image and 66 video, across 35 documented model families. Each entry preserves the native endpoint ID, full JSON Schema, source page and documentation SHA-256. The separately documented Soul ID operation trains a custom reference; it is not an image-generation endpoint and is excluded.

The catalog describes the public developer API. It does not assert that an account has credits or permission for every endpoint. The consumer application, its CLI and OpenRouter have different model catalogs; their model IDs are not converted into guessed Higgsfield endpoints. The former FLUX Kontext fallback is absent because no matching endpoint exists in the verified current API documentation.

The local API serves the entire reviewed snapshot immediately with `source: cached`, its verification date and `scope: public-documentation`. Runtime documentation crawling is deliberately disabled: global navigation links can mix model categories and overwrite valid schemas with incomplete pages. Updating the snapshot requires reviewing all workflow schemas and passing the catalog contract tests. There is no verified general-purpose model-discovery API in the current official SDK.

The public API Console was checked separately on 2026-09-26 at [Explore](https://open.higgsfield.ai/explore). Its public discovery response, [catalog-models](https://dash.higgsfield.ai/api/v2/catalog-models/?page_size=100), returned 29 model-family records and five workflow records. Every model's default endpoint was already present in the reviewed snapshot. The response's advertised count was 35 despite containing 34 records, so that count is not treated as a completeness guarantee. Public searches returned two Seedance families (2.0 and 2.5) and no matches for Nano Banana or Seedream. This establishes what the public catalog exposed at that time, not availability for every account. Older official SDK examples mention Nano Banana Pro and Seedream v4; those examples alone do not establish a currently supported endpoint. The consumer website and its account-based CLI remain separate from this API-key integration.

The picker loads both image and video catalogs regardless of the current block, with independent type and provider filters. Selecting another media type creates a new block beside the source with the prompt and selected model; an existing image can become its reference when the selected route accepts images. Selecting a video model never rewrites the original image block. The empty Higgsfield search links directly to the official API catalog instead of inventing a missing route.

The editor currently supplies prompts, image references, aspect ratio, resolution, duration and output count. At verification time 68 endpoints accept these inputs; 13 video workflows need video or other unsupported inputs. Unsupported workflows stay identifiable with a reason. Alternate text/image/reference workflows share a canonical family only when model version and quality match. Fast, Pro, Standard, Turbo, 4K and Recraft Utility variants remain distinct. Routing never changes the provider or silently substitutes an unsupported editing operation.

Payloads are validated with their complete JSON Schemas before upload and again with returned public URLs. Explicit invalid options are rejected. The legacy generic `1K` UI size can use a documented model default when that model uses different resolution labels; exact supported labels retain their documented case. Omitted duration uses the official default. Local PNG/JPEG/WebP images follow the official signed-upload flow, with API authorization excluded from the storage PUT request.

Sources:

- [Official model index](https://docs.higgsfield.ai/docs/models)
- [Image generation models](https://docs.higgsfield.ai/docs/models/image-generation)
- [Video generation models](https://docs.higgsfield.ai/docs/models/video-generation)
- [Documentation index and authority notes](https://docs.higgsfield.ai/docs/llms.txt)
- [Authentication](https://docs.higgsfield.ai/docs/authentication)
- [File uploads](https://docs.higgsfield.ai/docs/concepts/file-uploads)
- [Official JavaScript SDK](https://github.com/higgsfield-ai/higgsfield-js)

`server/higgsfield.test.ts` validates the complete snapshot, defaults for every supported schema, canonical quality boundaries, reference-count routing, rejection before billable requests, signed upload separation, authentication/permission errors and empty cancellation responses. All HTTP in these tests is mocked; no real credentials or paid generation calls are used.
