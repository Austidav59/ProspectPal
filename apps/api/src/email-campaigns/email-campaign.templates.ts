import type { EmailOfferType } from "../generated/prisma";

export interface OfferTemplate {
  label: string;
  description: string;
  defaultName: string;
  subject: string;
  body: string;
}

export const OFFER_TEMPLATES: Record<EmailOfferType, OfferTemplate> = {
  NEED_WEBSITE: {
    label: "Need a website",
    description:
      "Businesses with no website saved, but an email found (Places, Facebook, or enrichment).",
    defaultName: "Website offer",
    subject: "A free website idea for {name}",
    body:
      "Hi {name},\n\n" +
      "I came across your business while looking at local companies in {city}. " +
      "It looks like you don't have a website yet — a simple site helps customers find you, " +
      "see what you offer, and get in touch.\n\n" +
      "I put together a quick, no-obligation mockup of what your site could look like. " +
      "Want me to send it over?\n\n" +
      "Best,\nProspect Pal",
  },
  NEED_SEO: {
    label: "Need SEO / ranking",
    description: "Businesses that already have a website and could use help ranking on Google.",
    defaultName: "SEO ranking offer",
    subject: "Quick ideas to help {name} rank higher on Google",
    body:
      "Hi {name},\n\n" +
      "I was researching local businesses in {city} and found your site. " +
      "I noticed a few opportunities that could help you show up higher when people search nearby.\n\n" +
      "Happy to share a short, free checklist tailored to {name} — no pitch deck, just practical fixes. " +
      "Want me to send it?\n\n" +
      "Best,\nProspect Pal",
  },
  NEED_REVIEWS: {
    label: "Need review help",
    description: "Businesses with few reviews (or room to improve ratings) that have an email on file.",
    defaultName: "Review growth offer",
    subject: "Help {name} earn more Google reviews",
    body:
      "Hi {name},\n\n" +
      "I found {name} while researching businesses in {city}. " +
      "Reviews are one of the biggest trust signals for local customers — and a steady flow of new ones " +
      "can make a real difference.\n\n" +
      "I help businesses set up a simple system to collect more Google reviews without being pushy. " +
      "Want a free walkthrough of what that could look like for you?\n\n" +
      "Best,\nProspect Pal",
  },
};

export function fillTemplate(
  template: string,
  vars: { name: string; city: string },
): string {
  return template
    .replaceAll("{name}", vars.name)
    .replaceAll("{city}", vars.city || "your area");
}
