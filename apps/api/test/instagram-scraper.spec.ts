import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { InstagramScraperService } from "../src/scraping/instagram-scraper.service";

describe("InstagramScraperService", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html");
      if (request.url === "/") {
        response.end(
          '<html><a href="/reach-us">Connect with our team</a></html>',
        );
        return;
      }
      if (request.url === "/reach-us") {
        response.end(`
          <html>
            <p>Email hello [at] acme-pressure [dot] com</p>
            <a href="//www.facebook.com/profile.php?id=61584153770206">Facebook</a>
          </html>
        `);
        return;
      }
      response.statusCode = 404;
      response.end("Not found");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not start");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("crawls internal pages and extracts obfuscated email and Facebook", async () => {
    const scraper = new InstagramScraperService();
    const result = await scraper.scanWebsite(origin);

    expect(result.email).toBe("hello@acme-pressure.com");
    expect(result.facebookUrl).toBe(
      "https://www.facebook.com/profile.php?id=61584153770206",
    );
  });
});
