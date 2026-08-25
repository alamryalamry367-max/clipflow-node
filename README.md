# VOOXOR

A mobile-first, compliant direct-media downloader MVP.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## V1 scope
- Direct HTTP/HTTPS video URLs only.
- URL validation and private-network/SSRF protection.
- Video content-type verification.
- Streaming download endpoint.
- Responsive landing page.
- Privacy and Terms placeholders.
- robots.txt and sitemap.xml.

## Not included intentionally
- Bypassing social-platform protections.
- DRM circumvention.
- Scraping private/authenticated content.
- Automatic extraction from arbitrary platform pages.

## Production checklist
- Use HTTPS.
- Add rate limiting and CAPTCHA where needed.
- Configure observability and retention policies.
- Finalize privacy/terms/DMCA or equivalent legal process.
- Connect analytics and an approved ad provider only after the site meets that provider's policies.
- Add only official/API/export integrations that are permitted by the relevant service.
