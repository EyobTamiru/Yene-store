/**
 * ============================================================================
 *  CATEGORY MOVE TABLES
 * ============================================================================
 *
 *  The board moved from a 14-section product taxonomy to the 18-section
 *  classifieds taxonomy in `src/platform/categories.ts`. These tables record
 *  what went where, and are the only place the old ids are allowed to appear.
 *
 *  WHY A TABLE AND NOT A RULE
 *  --------------------------
 *  Most of these moves are mechanical - a parent moved, so its children moved
 *  with it - but not all of them. "Jewellery" became "Jewellery & Watches",
 *  "Sportswear" left "Sports" for "Leisure & Activities", and four separate old
 *  children ("Printers & Scanners", "Monitors", "Computer Accessories",
 *  "Desktops") now sit under ONE new parent as "Computer Accessories". A rule
 *  could not produce that; a table can, and it reads as a statement of intent.
 *
 *  `fashion` and `electronics` keep their ids and so are absent from the main
 *  table - listing them would imply a rename that never happened.
 */

import { subcategoryId } from "../src/platform/categories";

/** Old main category id -> new main category id. */
export const CATEGORY_MOVES: Record<string, string> = {
  phones: "phones-tablets",
  food: "food-agriculture-farming",
  home: "home-furniture-appliances",
  beauty: "beauty-personal-care",
  automotive: "vehicles",
  sports: "leisure-activities",
  office: "business-industry",
  industrial: "commercial-equipment-tools",
  other: "others",
  computers: "electronics",
  perfume: "beauty-personal-care",
};

/** Old subcategory id -> new subcategory id. */
export const SUBCATEGORY_MOVES: Record<string, string> = {
  "fashion-jewellery": subcategoryId("fashion", "Jewellery & Watches"),
  "electronics-home-appliances": subcategoryId("home-furniture-appliances", "Kitchen Appliances"),
  "electronics-gaming": subcategoryId("electronics", "Gaming Consoles"),
  "electronics-audio": subcategoryId("electronics", "Audio & Sound"),
  "electronics-cameras": subcategoryId("electronics", "Cameras & Camcorders"),
  "phones-smartphones": subcategoryId("phones-tablets", "Smartphones"),
  "phones-feature-phones": subcategoryId("phones-tablets", "Feature Phones"),
  "phones-tablets": subcategoryId("phones-tablets", "Tablets"),
  "phones-phone-accessories": subcategoryId("phones-tablets", "Phone Accessories"),
  "computers-laptops": subcategoryId("electronics", "Laptops & Desktops"),
  "computers-desktops": subcategoryId("electronics", "Laptops & Desktops"),
  "computers-monitors": subcategoryId("electronics", "Computer Accessories"),
  "computers-computer-accessories": subcategoryId("electronics", "Computer Accessories"),
  "computers-printers-scanners": subcategoryId("electronics", "Computer Accessories"),
  "food-coffee-tea": subcategoryId("food-agriculture-farming", "Coffee & Tea"),
  "food-spices": subcategoryId("food-agriculture-farming", "Spices & Sauces"),
  "food-beverages": subcategoryId("food-agriculture-farming", "Fresh Produce"),
  "food-dairy-eggs": subcategoryId("food-agriculture-farming", "Fresh Produce"),
  "food-snacks": subcategoryId("food-agriculture-farming", "Grains & Pulses"),
  "home-furniture": subcategoryId("home-furniture-appliances", "Furniture"),
  "home-kitchenware": subcategoryId("home-furniture-appliances", "Kitchen Appliances"),
  "home-home-decor": subcategoryId("home-furniture-appliances", "Home Decor"),
  "home-bedding-linen": subcategoryId("home-furniture-appliances", "Bedding & Linen"),
  "home-garden-outdoor": subcategoryId("home-furniture-appliances", "Garden & Outdoor"),
  "beauty-makeup": subcategoryId("beauty-personal-care", "Makeup"),
  "beauty-skincare": subcategoryId("beauty-personal-care", "Skincare"),
  "beauty-haircare": subcategoryId("beauty-personal-care", "Haircare"),
  "beauty-personal-care": subcategoryId("beauty-personal-care", "Salon & Spa"),
  "automotive-car-parts": subcategoryId("vehicles", "Vehicle Parts"),
  "automotive-motorcycles": subcategoryId("vehicles", "Motorcycles"),
  "automotive-car-care": subcategoryId("vehicles", "Car Accessories"),
  "automotive-vehicle-accessories": subcategoryId("vehicles", "Car Accessories"),
  "sports-fitness-gym": subcategoryId("leisure-activities", "Fitness & Gym"),
  "sports-team-sports": subcategoryId("leisure-activities", "Team Sports"),
  "sports-outdoor-camping": subcategoryId("leisure-activities", "Camping & Outdoor"),
  "sports-cycling": subcategoryId("leisure-activities", "Camping & Outdoor"),
  "sports-sportswear": subcategoryId("leisure-activities", "Sportswear"),
  "industrial-machinery": subcategoryId("commercial-equipment-tools", "Factory Machinery"),
  "industrial-construction-tools": subcategoryId("commercial-equipment-tools", "Power Tools"),
  "industrial-safety-equipment": subcategoryId("commercial-equipment-tools", "Safety Equipment"),
  "industrial-raw-materials": subcategoryId("business-industry", "Manufacturing"),
};