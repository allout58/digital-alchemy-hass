import {
  ApplicationDefinition,
  OptionalModuleConfiguration,
  ServiceMap,
  sleep,
  TServiceParams,
} from "@digital-alchemy/core";

import { ANY_ENTITY, ENTITY_STATE } from "../helpers";
import { CreateTestingApplication, SILENT_BOOT } from "../mock_assistant";

describe("Entity", () => {
  let application: ApplicationDefinition<
    ServiceMap,
    OptionalModuleConfiguration
  >;

  afterEach(async () => {
    if (application) {
      await application.teardown();
      application = undefined;
    }
    jest.restoreAllMocks();
  });

  describe("API", () => {
    describe("Updates", () => {
      it("should debounce updates properly", async () => {
        expect.assertions(1);
        application = CreateTestingApplication({
          Test({ lifecycle, hass }: TServiceParams) {
            jest
              .spyOn(hass.socket, "sendMessage")
              .mockImplementation(async () => undefined);
            let counter = 0;
            hass.events.onEntityRegistryUpdate(() => counter++);
            lifecycle.onReady(async () => {
              setImmediate(async () => {
                hass.socket.socketEvents.emit("entity_registry_updated");
                await sleep(5);
                hass.socket.socketEvents.emit("entity_registry_updated");
                await sleep(5);
                hass.socket.socketEvents.emit("entity_registry_updated");
                await sleep(20);
                hass.socket.socketEvents.emit("entity_registry_updated");
              });
              await sleep(50);
              expect(counter).toBe(2);
            });
          },
        });
        await application.bootstrap(
          SILENT_BOOT({
            hass: {
              AUTO_CONNECT_SOCKET: false,
              AUTO_SCAN_CALL_PROXY: false,
              EVENT_DEBOUNCE_MS: 10,
            },
          }),
        );
      });

      it("should emit updates on change", async () => {
        expect.assertions(3);
        application = CreateTestingApplication({
          Test({ lifecycle, hass, event }: TServiceParams) {
            lifecycle.onReady(() => {
              const old_state = hass.entity.getCurrentState("sensor.magic");
              const new_state = { ...old_state, state: "test" };
              const spy = jest.spyOn(event, "emit");
              hass.entity._entityUpdateReceiver(
                "sensor.magic",
                new_state,
                old_state,
              );
              expect(spy).toHaveReturnedTimes(2);
              expect(spy).toHaveBeenCalledWith(
                "sensor.magic",
                new_state,
                old_state,
              );
              expect(spy).toHaveBeenCalledWith(
                "e1806fdc93296bbd5ab42967003cd38729ff9ba6cfeefc3e15a03ad01ac894fe",
                new_state,
                old_state,
              );
            });
          },
        });
        await application.bootstrap(
          SILENT_BOOT({ hass: { MOCK_SOCKET: true } }, true),
        );
      });

      it("returns undefined from nextState when timeout is exceeded", async () => {
        expect.assertions(1);
        application = CreateTestingApplication({
          Test({ lifecycle, hass }: TServiceParams) {
            lifecycle.onReady(async () => {
              const entity = hass.refBy.id("sensor.magic");
              const old_state = hass.entity.getCurrentState("sensor.magic");

              // Set a timeout of 100ms
              const wait = new Promise<ENTITY_STATE<ANY_ENTITY> | undefined>(
                async done => {
                  done(await entity.nextState(25));
                },
              );

              // Simulate delay longer than the timeout to ensure timeout is exceeded
              setTimeout(() => {
                const new_state = { ...old_state, state: "test" };
                hass.entity._entityUpdateReceiver(
                  "sensor.magic",
                  new_state,
                  old_state,
                );
              }, 50); // 200ms delay

              const result = await wait;
              expect(result).toBeUndefined();
            });
          },
        });
        await application.bootstrap(
          SILENT_BOOT({ hass: { MOCK_SOCKET: true } }, true),
        );
      });
    });

    it("should find entities by unique_id", async () => {
      expect.assertions(2);
      application = CreateTestingApplication({
        Test({ lifecycle, hass }: TServiceParams) {
          lifecycle.onReady(() => {
            const entity = hass.refBy.unique_id(
              "5622d76001a335e3ea893c4d60d31b3d-next_dawn",
            );
            expect(entity).toBeDefined();
            expect(entity.entity_id).toBe("sensor.sun_next_dawn");
          });
        },
      });
      await application.bootstrap(
        SILENT_BOOT({ hass: { MOCK_SOCKET: true } }, true),
      );
    });

    it("should return unmodified entity state with .raw", async () => {
      expect.assertions(1);
      application = CreateTestingApplication({
        Test({ lifecycle, hass }: TServiceParams) {
          lifecycle.onReady(() => {
            const allData = hass.entity._masterState();
            const single = hass.entity.getCurrentState("sun.sun");
            expect(single).toBe(allData.sun.sun);
          });
        },
      });
      await application.bootstrap(
        SILENT_BOOT({ hass: { MOCK_SOCKET: true } }, true),
      );
    });

    it("should return previous entity state with .previous", async () => {
      expect.assertions(3);
      application = CreateTestingApplication({
        Test({ lifecycle, hass, mock_assistant }: TServiceParams) {
          const entity_id = "sensor.magic";
          const value = "bar";
          lifecycle.onReady(async () => {
            const start = hass.entity.getCurrentState(entity_id);
            await mock_assistant.events.emitEntityUpdate(entity_id, {
              state: value,
            });
            const updated = hass.entity.getCurrentState(entity_id);
            const previous = hass.entity.previousState(entity_id);
            expect(updated.state).toBe(value);
            expect(start.state).not.toBe(value);
            expect(start).toEqual(previous);
          });
        },
      });
      await application.bootstrap(
        SILENT_BOOT({ hass: { MOCK_SOCKET: true } }, true),
      );
    });

    it("should return undefined for no matches", async () => {
      expect.assertions(1);
      application = CreateTestingApplication({
        Test({ lifecycle, hass }: TServiceParams) {
          lifecycle.onReady(() => {
            const entity = hass.refBy.unique_id(
              // @ts-expect-error test
              "5622d76001a335e3ea893c4d60d31b3d-previous_dawn",
            );
            expect(entity).not.toBeDefined();
          });
        },
      });
      await application.bootstrap(
        SILENT_BOOT({ hass: { MOCK_SOCKET: true } }, true),
      );
    });
  });

  describe("Refresh", () => {
    it("should attempt to load entities onBootstrap", async () => {
      expect.assertions(2);
      application = CreateTestingApplication({
        Test({ lifecycle, hass }: TServiceParams) {
          const spy = jest
            .spyOn(hass.entity, "refresh")
            .mockImplementation(async () => undefined);

          lifecycle.onPostConfig(function latePostConfig() {
            expect(spy).toHaveBeenCalled();
          }, -1);
          lifecycle.onPostConfig(function earlyPostConfig() {
            expect(spy).not.toHaveBeenCalled();
          }, 0);
        },
      });
      await application.bootstrap(
        SILENT_BOOT({ hass: { MOCK_SOCKET: true } }, true),
      );
    });

    it("should not attempt to load entities onBootstrap if AUTO_CONNECT_SOCKET is false", async () => {
      expect.assertions(1);
      application = CreateTestingApplication({
        Test({ lifecycle, hass }: TServiceParams) {
          const spy = jest
            .spyOn(hass.entity, "refresh")
            .mockImplementation(async () => undefined);

          lifecycle.onBootstrap(() => {
            expect(spy).not.toHaveBeenCalled();
          });
        },
      });
      await application.bootstrap(
        SILENT_BOOT(
          { hass: { AUTO_CONNECT_SOCKET: false, MOCK_SOCKET: true } },
          true,
        ),
      );
    });

    it("should retry on failure", async () => {
      expect.assertions(1);
      application = CreateTestingApplication({
        Test({ lifecycle, hass }: TServiceParams) {
          const responses = [
            { text: "502 Bad Gateway" },
            { text: "502 Bad Gateway" },
            { text: "502 Bad Gateway" },
            [],
            [{ entity_id: "sensor.magic" } as ENTITY_STATE<ANY_ENTITY>],
          ];
          const spy = jest
            .spyOn(hass.fetch, "getAllEntities")
            // @ts-expect-error it happens
            .mockImplementation(async () => responses.shift());

          lifecycle.onBootstrap(() => expect(spy).toHaveBeenCalledTimes(5));
        },
      });
      await application.bootstrap(
        SILENT_BOOT({ hass: { MOCK_SOCKET: true, RETRY_INTERVAL: 0 } }, true),
      );
    });
  });
});
