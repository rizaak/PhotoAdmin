import { Cormorant_Garamond, Inter, Playfair_Display, Nunito, EB_Garamond, Lato } from "next/font/google";

const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-cormorant" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const playfair = Playfair_Display({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-playfair" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-nunito" });
const ebGaramond = EB_Garamond({ subsets: ["latin"], variable: "--font-garamond" });
const lato = Lato({ subsets: ["latin"], weight: ["300", "400", "700"], variable: "--font-lato" });

// className con todas las CSS vars — se aplica una vez en el wrapper de /g/[slug]
export const fontVariables = [cormorant, inter, playfair, nunito, ebGaramond, lato]
  .map((f) => f.variable).join(" ");
