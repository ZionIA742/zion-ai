import { strict as assert } from "node:assert";
import {
  buildGoogleMapsDirectionsUrl,
  buildStoreAddressText,
  getTextFromRoutePayload,
} from "./google-maps-route";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
  {
    name: "store address text uses canonical general address fields",
    run: () => {
      assert.equal(
        buildStoreAddressText({
          has_public_address: true,
          street: "Av. Central",
          number: "100",
          complement: "Loja 2",
          district: "Centro",
          city: "Sao Paulo",
          state: "SP",
          cep: "01001000",
        }),
        "Av. Central, 100, Loja 2, Centro, Sao Paulo - SP, CEP 01001000"
      );
    },
  },
  {
    name: "store without complete public address cannot be route origin",
    run: () => {
      assert.equal(
        buildStoreAddressText({
          has_public_address: true,
          street: "Av. Central",
          number: "100",
          district: "",
          city: "Sao Paulo",
          state: "SP",
        }),
        null
      );
      assert.equal(buildStoreAddressText({ has_public_address: false }), null);
    },
  },
  {
    name: "directions url requires origin and destination and encodes both",
    run: () => {
      const url = buildGoogleMapsDirectionsUrl({
        origin: "Av. Central, 100, Sao Paulo - SP",
        destination: "Rua Cliente, 200, Campinas - SP",
      });

      assert.equal(
        url,
        "https://www.google.com/maps/dir/?api=1&origin=Av.+Central%2C+100%2C+Sao+Paulo+-+SP&destination=Rua+Cliente%2C+200%2C+Campinas+-+SP"
      );
      assert.equal(buildGoogleMapsDirectionsUrl({ origin: "", destination: "Rua A" }), null);
      assert.equal(buildGoogleMapsDirectionsUrl({ origin: "Rua B", destination: "" }), null);
    },
  },
  {
    name: "destination address comes from explicit route payload keys",
    run: () => {
      assert.equal(
        getTextFromRoutePayload({
          unrelated: "ignore",
          customerAddress: "Rua Cliente, 200",
        }),
        "Rua Cliente, 200"
      );
    },
  },
];

let passed = 0;

for (const test of tests) {
  try {
    test.run();
    passed += 1;
    console.log(`ok - ${test.name}`);
  } catch (error) {
    console.error(`not ok - ${test.name}`);
    throw error;
  }
}

console.log(`${passed}/${tests.length} google maps route tests passed`);

