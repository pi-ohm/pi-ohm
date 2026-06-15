import registerPiOhmExtension from "../packages/extension/src/extension";

type Pi = Parameters<typeof registerPiOhmExtension>[0];

export default function (pi: Pi) {
  registerPiOhmExtension(pi);
}
