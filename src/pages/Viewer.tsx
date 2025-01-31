import { useEffect } from 'react';
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import projectInformation from "../components/Panels/ProjectInformation";
import elementData from "../components/Panels/Selection";
import settings from "../components/Panels/Settings";
import load from "../components/Toolbars/Sections/Import";
import help from "../components/Panels/Help";
import camera from "../components/Toolbars/Sections/Camera";
import selection from "../components/Toolbars/Sections/Selection";
import miniMap from "../components/Panels/MiniMap"
import { AppManager } from "../bim-components";

const Viewer: React.FC = () => {
  useEffect(() => {

    const initViewer = async () => {
      BUI.Manager.init();
      const components = new OBC.Components();
      const worlds = components.get(OBC.Worlds);

      const world = worlds.create<
        OBC.SimpleScene,
        OBC.OrthoPerspectiveCamera,
        OBF.PostproductionRenderer
      >();
      world.name = "Main";

      world.scene = new OBC.SimpleScene(components);
      world.scene.setup();
      world.scene.three.background = null;

      const viewport = BUI.Component.create<BUI.Viewport>(() => {
        return BUI.html`
          <bim-viewport>
            <bim-grid floating></bim-grid>
          </bim-viewport>
        `;
      });

      world.renderer = new OBF.PostproductionRenderer(components, viewport);
      const { postproduction } = world.renderer;

      world.camera = new OBC.OrthoPerspectiveCamera(components);

      const worldGrid = components.get(OBC.Grids).create(world);
      worldGrid.material.uniforms.uColor.value = new THREE.Color(0x424242);
      worldGrid.material.uniforms.uSize1.value = 2;
      worldGrid.material.uniforms.uSize2.value = 8;

      const resizeWorld = () => {
        world.renderer?.resize();
        world.camera.updateAspect();
      };

      viewport.addEventListener("resize", resizeWorld);

      components.init();

      postproduction.enabled = true;
      postproduction.customEffects.excludedMeshes.push(worldGrid.three);
      postproduction.setPasses({ custom: true, ao: true, gamma: true });
      postproduction.customEffects.lineColor = 0x17191c;

      const appManager = components.get(AppManager);
      const viewportGrid = viewport.querySelector<BUI.Grid>("bim-grid[floating]")!;
      appManager.grids.set("viewport", viewportGrid);

      const fragments = components.get(OBC.FragmentsManager);
      const indexer = components.get(OBC.IfcRelationsIndexer);
      const classifier = components.get(OBC.Classifier);
      classifier.list.CustomSelections = {};

      const ifcLoader = components.get(OBC.IfcLoader);
      await ifcLoader.setup();

      const tilesLoader = components.get(OBF.IfcStreamer);
      tilesLoader.url = "../resources/tiles/";
      tilesLoader.world = world;
      tilesLoader.culler.threshold = 10;
      tilesLoader.culler.maxHiddenTime = 1000;
      tilesLoader.culler.maxLostTime = 40000;

      const highlighter = components.get(OBF.Highlighter);
      highlighter.setup({ world });
      highlighter.zoomToSelection = true;

      const culler = components.get(OBC.Cullers).create(world);
      culler.threshold = 5;

      world.camera.controls.restThreshold = 0.25;
      world.camera.controls.addEventListener("rest", () => {
        culler.needsUpdate = true;
        tilesLoader.culler.needsUpdate = true;
      });

      fragments.onFragmentsLoaded.add(async (model) => {
        if (model.hasProperties) {
          await indexer.process(model);
          classifier.byEntity(model);
        }

        for (const fragment of model.items) {
          world.meshes.add(fragment.mesh);
          culler.add(fragment.mesh);
        }

        world.scene.three.add(model);
        setTimeout(async () => {
          world.camera.fit(world.meshes, 0.8);
        }, 50);
      });

      fragments.onFragmentsDisposed.add(({ fragmentIDs }) => {
        for (const fragmentID of fragmentIDs) {
          const mesh = [...world.meshes].find((mesh) => mesh.uuid === fragmentID);
          if (mesh) world.meshes.delete(mesh);
        }
      });

      const projectInformationPanel = projectInformation(components);
      const elementDataPanel = elementData(components);

      const toolbar = BUI.Component.create(() => {
        return BUI.html`
          <bim-toolbar>
            ${load(components)}
            ${camera(world)}
            ${selection(components, world)}
          </bim-toolbar>
        `;
      });

      const leftPanel = BUI.Component.create(() => {
        return BUI.html`
          <bim-tabs switchers-full>
            <bim-tab name="project" label="Proyecto" icon="ph:building-fill">
              ${projectInformationPanel}
            </bim-tab>
            <bim-tab name="settings" label="Configuración" icon="solar:settings-bold">
              ${settings(components)}
            </bim-tab>
            <!-- <bim-tab name="help" label="Help" icon="material-symbols:help">
              ${help}
            </bim-tab> -->
          </bim-tabs> 
        `;
      });

      const miniMapComponent = miniMap(components, world);

      //const appContainer = document.getElementById("app") as HTMLElement
      const body = document.querySelector("body");
      //const app = document.querySelector("bim-grid") as BUI.Grid;
      const app = document.createElement("bim-grid") as BUI.Grid;
      //body!.innerHTML = "";
      body!.appendChild(app);

      app.layouts = {
        main: {
          template: `
            "leftPanel viewport" 1fr
            /26rem 1fr
          `,
          elements: {
            leftPanel,
            viewport,
          },
        },
      };

      app.layout = "main";

      viewportGrid.layouts = {
        main: {
          template: `
            "empty miniMap" 1fr
            "toolbar miniMap" auto
            /1fr auto
          `,
          elements: { 
            toolbar,
            miniMap: miniMapComponent
          },
        },
        second: {
          template: `
            "empty elementDataPanel miniMap" 1fr
            "toolbar elementDataPanel miniMap" auto
            /1fr 24rem auto
          `,
          elements: {
            toolbar,
            elementDataPanel,
            miniMap: miniMapComponent
          },
        },
      };
      viewportGrid.layout = "main";
    };

    initViewer();
    // Cleanup function
    return () => {
      const bim_grid = document.querySelector("bim-grid");
      if (bim_grid) {
        bim_grid.remove();
      }
      // Componente desmontado y limpieza realizada
    };
  }, []);

  return null;
};

export default Viewer;