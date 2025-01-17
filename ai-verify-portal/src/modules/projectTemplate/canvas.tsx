import React, { useState, useEffect, useRef, useMemo, MouseEvent, useCallback } from 'react';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Pagination from '@mui/material/Pagination';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import GridOnIcon from '@mui/icons-material/GridOn';
import OpenWithIcon from '@mui/icons-material/OpenWith';
import GridLayout, { DragOverEvent, ItemCallback, Layout } from "react-grid-layout";
import { ProjectTemplateStore, ARUActionTypes, MapActionTypes } from './projectTemplateContext';
import WidgetDataContext, { WidgetDataContextType } from './widgetDataContext';
import ReportWidgetComponent, { ReportWidgetComponentProps } from './reportWidget';
import { ReportWidget, UserDefinedProperty, MockDataType } from 'src/types/plugin.interface';
import { PropertyMap, ReportWidgetItem, GlobalVariable, LayoutItemProperties } from 'src/types/projectTemplate.interface';
import ConfirmationDialog from 'src/components/confirmationDialog';
import { ErrorBoundary } from 'react-error-boundary';
import clsx from 'clsx';
import styles from './styles/canvas.module.css';
import sharedStyles from './styles/shared/reportDefault.module.css';
import { DesignerLeftPanel } from './designerLeftPanel';
import { DesignerRightPanel } from './designerRightPanel';
import { IconButton } from 'src/components/iconButton';
import { getMdxWidgetBundle, MDXBundle } from './api/widget';
import { toErrorWithMessage } from 'src/lib/errorUtils';
import { GRID_ITEM_CLASSNAME, SelectedGridItemBoxOutline } from './gridItemBoxOutline';
import { CanvasErrorFallback } from './canvasErrorFallback';
import { getGridItemElement } from './utils/getGridItemElement';
import { WidgetPropertiesPanel } from './widgetPropertiesPanel';
import { ReportWidgetGridItemWrapper } from './gridItemWrapper';
import { getItemLayoutProperties } from 'src/lib/canvasUtils';
import { SelectedGridActionButtons } from './gridItemActionButtons';
import { elementIsWidgetPanel } from './utils/elementIsWidgetPanel';
import WidgetDataPopulationDialog from './widgetDataPopulationDialog';
import { DraggableAbsolutionPositon } from 'src/components/alertBox';
import { OutlinedInput } from '@mui/material';
import AddPageDialog from './addPageDialog';
import MovePageDialog from './movePageDialog';


type CanvasProps = {
  projectStore: ProjectTemplateStore,
  isTemplate?: boolean,
}

const GRID_WIDTH = 774;
const GRID_ROW_HEIGHT = 30;
const GRID_MAX_ROWS = 36;
const GRID_STRICT_STYLE: React.CSSProperties = { height: '1080px' };
const DEFAULT_LAYOUT_ITEM_PROPERITES: LayoutItemProperties = {
  justifyContent: 'left',
  alignItems: 'top',
};

export default function CanvasComponent(props: CanvasProps) {
  const { projectStore, isTemplate } = props;
  const [dragItem, setDragItem] = useState<ReportWidget | null>(null);
  const [selectedWidget, setSelectedWidget] = useState<ReportWidgetItem | null>(null);
  const [selectedPage, setSelectedPage] = useState<number>();
  const [selectedGridItemDomElement, setSelectedGridItemDomElement] = useState<HTMLDivElement | undefined>();
  const [componentProperties, setComponentProperties] = useState<Record<string, ReportWidgetComponentProps>>({});
  const [widgetDataContext, setWidgetDataContext] = useState<WidgetDataContextType>({});
  const [showPropertiesDialog, setShowPropertiesDialog] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [showGridLines, setShowGridLines] = useState(true);
  const [showGridItemActionMenu, setShowGridItemActionMenu] = useState(true);
  const [initialLayout, setinitialLayout] = useState<string[]>([]);
  const [showAddPageDialog, setShowAddPageDialog] = useState<boolean>(false);
  const [showMovePageDialog, setShowMovePageDialog] = useState<boolean>(false);
  const mounted = useRef<boolean>(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const currentPageNo = useRef(-1);
  let selectedGridItemLayout;
  let selectedWidgetHasProperties = false;
  const dataPopulationDialogPosition: DraggableAbsolutionPositon = {x: 0, y: 0};

  let gridLayouts: Layout[] = [];
  
  if (currentPageNo.current !== undefined && currentPageNo.current >= 0 && currentPageNo.current < projectStore.pages.length) {
    const page = projectStore.pages[currentPageNo.current];
    if (page.layouts) gridLayouts = page.layouts;
    if (selectedWidget) {
      selectedGridItemLayout = page.layouts ? page.layouts.find(item => item.i === selectedWidget.key) : undefined;
      selectedWidgetHasProperties = selectedWidget.widget && Boolean(selectedWidget.properties && Object.keys(selectedWidget.properties).length);
    }
    if (showPropertiesDialog) {
      if (selectedGridItemDomElement) {
        const scrollContainer = document.getElementsByClassName('scrollContainer')[0];
        const domDimensions = selectedGridItemDomElement.getBoundingClientRect();
        dataPopulationDialogPosition.x = domDimensions.x + domDimensions.width / 2;
        if (window.innerHeight - 54 - domDimensions.top > 380) { // 54 = height of topbar / 380 = height of dialog
          dataPopulationDialogPosition.y = domDimensions.top + scrollContainer.scrollTop;
        } else
          dataPopulationDialogPosition.y = domDimensions.top + scrollContainer.scrollTop - 380;
      }
    }
    
  }

  function handleCanvasDomElementClick(item: ReportWidgetItem) {
    return (e: MouseEvent) => {
      e.preventDefault();
      const gridItem = getGridItemElement(e.target as HTMLElement);
      setSelectedWidget(item);
      setShowGridItemActionMenu(true);
      if (gridItem) setSelectedGridItemDomElement(gridItem);
    }
  }

  function triggerGridItemElementClick(widgetKey: string) {
    setTimeout(() => {
      if (canvasRef.current) {
        const addedGridItemEl = canvasRef.current.querySelector(`#div-${widgetKey}`);
        if (addedGridItemEl instanceof HTMLDivElement) addedGridItemEl.click();
      }
    });
  }

  const wrapAndDispatchWidgetComponent = async (reportWidget: ReportWidgetItem, mdxBundle: MDXBundle, layoutItem: Partial<Layout>) => {
    if (!currentPage())
      return
    const ctx: ReportWidgetComponentProps = componentProperties[reportWidget.key] || {
      mykey: reportWidget.key,
      mdxBundle,
      meta: reportWidget.widget,
      result: {},
      inputBlockData: {}
    };
    // set properties
    if (reportWidget.properties) {
      const properties: Record<string, string> = {};
      for (const key of Object.keys(reportWidget.properties)) {
        properties[key] = projectStore.widgetProperties.getProperty(reportWidget.properties[key]);
      }
      const widgetData = widgetDataContext[reportWidget.key] || {};
      widgetData.properties = properties;
      setWidgetDataContext(prevState => ({
        ...prevState,
        [reportWidget.key]: widgetData,
      }))
    }
    // set mock data
    if (reportWidget.widget.mockdata) {
      for (const mock of reportWidget.widget.mockdata) {
        if (mock.type === MockDataType.Algorithm) {
          ctx.result[mock.gid] = mock.data;
        } else {
          ctx.inputBlockData[mock.gid] = mock.data;
        }
      }
    }

    setComponentProperties(prevState => ({
      ...prevState,
      [reportWidget.key]: ctx,
    }))
    
    const payload = <ReportWidgetGridItemWrapper
      id={reportWidget.key}
      key={reportWidget.key}
      data-grid={layoutItem}
      onClick={handleCanvasDomElementClick(reportWidget)}
      onRightClick={handleCanvasDomElementClick(reportWidget)}
      wrapperStyles={getItemLayoutProperties(reportWidget.layoutItemProperties, true)}>
        <ReportWidgetComponent {...ctx} />
      </ReportWidgetGridItemWrapper>
    projectStore.dispatchReportWidgetComponents({ type: MapActionTypes.SET, key: reportWidget.key, payload })

    return payload;
  }

  async function addItem(widget: ReportWidget, mdxBundle: MDXBundle, layoutItem: Partial<Layout>): Promise<ReportWidgetItem | undefined> {
    if (!currentPage()) return;

    const key = (new Date()).getTime().toString();
    const properties: PropertyMap = {};
    if (widget.properties) {
      for (const prop of widget.properties) {
        properties[prop.key] = prop.default || '';
      }
    }
    const widgetItem: ReportWidgetItem = {
      widget,
      widgetGID: widget.gid,
      key,
      properties,
      layoutItemProperties: { ...DEFAULT_LAYOUT_ITEM_PROPERITES }
    }

    // check for dependencies
    if (widgetItem.widget && widgetItem.widget.dependencies) {
      projectStore.addReportWidget(widgetItem);
    }
    
    await wrapAndDispatchWidgetComponent(widgetItem, mdxBundle, layoutItem);
    const page = currentPage();
    if (!page) return;
    const reportWidgets = [
      ...page.reportWidgets,
      widgetItem,
    ] as ReportWidgetItem[];
    projectStore.dispatchPages({ type: ARUActionTypes.UPDATE, index: currentPageNo.current, payload: { reportWidgets } })
    if (widgetItem.widget && widgetItem.widget.dependencies) {
      projectStore.addReportWidget(widgetItem);
    }
    return widgetItem;
  }

  const loadPage = async (pageNo: number) => {
    setShowPropertiesDialog(false);
    setSelectedWidget(null);
    const page = projectStore.pages[pageNo]; // go to first page
    if (page.layouts && page.layouts.length > 1)
      setinitialLayout(page.layouts.map(l => l.i));
    else
      setinitialLayout([]);
    currentPageNo.current = pageNo;
    for (const layout of page.layouts) {
      const reportWidget = page.reportWidgets.find(e => e.key == layout.i);
      if (!reportWidget) {
        console.warn("Invalid widget key", layout);
        continue;
      }
      const widget = reportWidget.widget;
      if (!widget) {
        addInvalidWidget(reportWidget, layout)
      } else if (!projectStore.widgetBundleCache[widget.gid]) {
        document.body.style.cursor = 'wait';
        try {
          const mdxBundle = await getMdxWidgetBundle(widget.gid);
          projectStore.dispatchWidgetBundleCache({type: MapActionTypes.SET, key: widget.gid, payload: mdxBundle });
          if ('code' in mdxBundle)
            wrapAndDispatchWidgetComponent(reportWidget as ReportWidgetItem, mdxBundle, layout)
          document.body.style.cursor = 'default';
        } catch(err) {
          const error = toErrorWithMessage(err);
          console.error(error);
          document.body.style.cursor = 'default';
        }
      } else {
        wrapAndDispatchWidgetComponent(reportWidget, projectStore.widgetBundleCache[widget.gid], layout);
      }
    }
  }

  const addInvalidWidget = (reportWidget: ReportWidgetItem, layoutItem: Partial<Layout>): void => {
    const key = layoutItem.i as string;
    const comp = <ReportWidgetGridItemWrapper
    id={reportWidget.key}
    key={reportWidget.key}
    data-grid={layoutItem}
    onClick={handleCanvasDomElementClick(reportWidget)}
    onRightClick={handleCanvasDomElementClick(reportWidget)}
      className={clsx(
        styles.reportWidgetComponent,
        styles.invalidWidget,
        GRID_ITEM_CLASSNAME,
      )}>
      <h4 style={{ color: '#f73939' }}>Invalid Widget</h4>
    </ReportWidgetGridItemWrapper>
    projectStore.dispatchReportWidgetComponents({ type: MapActionTypes.SET, key, payload: comp })
  }


  const currentPage = () => {
    if (currentPageNo.current < 0)
      return null;
    return projectStore.pages[currentPageNo.current];
  }

  const combinedGlobalVars = useMemo(() => {
    return [
      ...Object.entries(projectStore.projectInfo).filter((item) => item[0] !== '__typename').map((item) => ({ key: item[0], value: item[1] })),
      ...projectStore.globalVars,
    ] as GlobalVariable[]
  }, [projectStore.globalVars, projectStore.projectInfo])

  function handleAddPageClick(pageIndex = -1) {
    setinitialLayout([])
    setShowPropertiesDialog(false);
    setSelectedWidget(null);
    const count = projectStore.pages.length;
    const page = {
      layouts: [],
      reportWidgets: []
    }
    if (pageIndex < 0)
      projectStore.dispatchPages({ type: ARUActionTypes.ADD, payload: page })
    else
      projectStore.dispatchPages({ type: ARUActionTypes.INSERT, payload: page, index: pageIndex })
    currentPageNo.current = (pageIndex < 0?count:pageIndex);
  }

  function handleGridToggleClick() {
    setShowGridLines(prev => !prev);
  }

  function handleDeletePageClick() {
    setShowDeleteConfirmation(true);
  }

  const onDeletePageConfirmationClose = (confirm: boolean) => {
    setShowDeleteConfirmation(false);
    if (!confirm)
      return;

    const pageIdx = currentPageNo.current;
    if (pageIdx < 0) // should not happen...
      return;

    setShowPropertiesDialog(false);
    setSelectedWidget(null);
    const count = projectStore.pages.length;
    projectStore.deletePage(pageIdx);
    projectStore.dispatchPages({ type: ARUActionTypes.REMOVE, index: pageIdx })
    if (count == 1) {
      handleAddPageClick(); // if no more page, automatically create a new one
      loadPage(0);
    } else if (pageIdx === count - 1) { // last page
      loadPage(pageIdx - 1);
    } else {
      loadPage(pageIdx);
    }

  }

  const onChangePage = (event: React.ChangeEvent<unknown>, page: number) => {
    loadPage(page - 1);
  }

  const handlePropertiesClose = () => {
    setShowPropertiesDialog(false);
  }

  function handleDeleteWidgetClick() {
    if (selectedWidget === null)
      return;

    const page = currentPage();
    if (!page)
      return;
    const key = selectedWidget.key;
    const widgetIdx = page.reportWidgets.findIndex(e => e.key === key);
    const reportWidget = page.reportWidgets[widgetIdx];
    const layoutIdx = page.layouts.findIndex(e => e.i == key)
    page.layouts.splice(layoutIdx, 1);
    page.reportWidgets.splice(widgetIdx, 1);
    projectStore.dispatchPages({ type: ARUActionTypes.UPDATE, payload: page, index: currentPageNo.current })
    projectStore.dispatchReportWidgetComponents({ type: MapActionTypes.UNSET, key })
    if (!reportWidget.widget) {
      console.log('Deleting an invalid widget');
      projectStore.removeReportWidget(reportWidget);
    } else if (reportWidget.widget.dependencies && reportWidget.widget.dependencies.length > 0) {
      projectStore.removeReportWidget(reportWidget);
    }
    setComponentProperties(prevState => {
      const nextState = { ...prevState };
      delete nextState[key];
      return nextState;
    });
    setSelectedWidget(null);
    setShowPropertiesDialog(false);
    setSelectedGridItemDomElement(undefined);
  }

  function handleEditWidgetClick() {
    setShowPropertiesDialog(true);
  }

  const handleChangeProperty = (prop: UserDefinedProperty, value: string) => {
    if (selectedWidget === null)
      return;

    const page = currentPage();
    if (!page)
      return;
    const widget = page.reportWidgets.find(e => e.key === selectedWidget?.key)
    if (!widget)
      return;
    if (!widget.properties)
      widget.properties = {};
    widget.properties[prop.key] = value;
    projectStore.dispatchPages({ type: ARUActionTypes.UPDATE, payload: page, index: currentPageNo.current })
    const ctx = widgetDataContext[selectedWidget.key];
    if (!ctx.properties)
      ctx.properties = {};
    ctx.properties[prop.key] = projectStore.widgetProperties.getProperty(value);
    setWidgetDataContext(prevState => ({
      ...prevState,
      [selectedWidget.key]: ctx,
    }))
  }

  const handleVisualStylePropertyChange = function(prop: keyof LayoutItemProperties, value: string) {
    if (projectStore.isReadonly)
      return;

    if (selectedWidget === null)
      return;
    const page = currentPage();
    if (!page)
      return;
    const reportWidget = page.reportWidgets.find(e => e.key === selectedWidget?.key)
    if (!reportWidget)
      return;

    const key = selectedWidget.key;
    const layoutItem = page.layouts.find(e => e.i == key);

    reportWidget.layoutItemProperties[prop] = value;
    projectStore.dispatchPages({ type: ARUActionTypes.UPDATE, payload: page, index: currentPageNo.current })

    const payload = <ReportWidgetGridItemWrapper
      id={reportWidget.key}
      key={reportWidget.key}
      data-grid={layoutItem}
      onClick={handleCanvasDomElementClick(reportWidget)}
      onRightClick={handleCanvasDomElementClick(reportWidget)}
      wrapperStyles={getItemLayoutProperties(selectedWidget.layoutItemProperties, true)}>
        <ReportWidgetComponent {...componentProperties[key]} />
      </ReportWidgetGridItemWrapper>

    projectStore.dispatchReportWidgetComponents({ type: MapActionTypes.SET, key, payload })
  };

  const onDrop = async (_l: Layout[], layout: Layout) => {
    if (!dragItem || !layout)
      return;
    let addedWidgetGridItem: ReportWidgetItem | undefined;
    const widget = dragItem;
    const {x, y, w, h} = layout;
    const {minW, minH, maxW, maxH} = widget.widgetSize;
    const newLayout = {x, y, w, h, minW, minH, maxW, maxH};
    if (!projectStore.widgetBundleCache[widget.gid]) {
      document.body.style.cursor = 'wait';
      try {
        const mdxBundle = await getMdxWidgetBundle(widget.gid);
        projectStore.dispatchWidgetBundleCache({type: MapActionTypes.SET, key: widget.gid, payload: mdxBundle });
        if ('code' in mdxBundle)
          addedWidgetGridItem = await addItem(widget, mdxBundle, newLayout);
          if (addedWidgetGridItem) {
            setSelectedWidget(addedWidgetGridItem);
            triggerGridItemElementClick(addedWidgetGridItem.key);
          }
        document.body.style.cursor = 'default';
      } catch(err) {
        const error = toErrorWithMessage(err);
        console.error(error);
        document.body.style.cursor = 'default';
      }
    } else {
      addedWidgetGridItem = await addItem(widget, projectStore.widgetBundleCache[widget.gid], newLayout);
      if (addedWidgetGridItem) {
        setSelectedWidget(addedWidgetGridItem);
        triggerGridItemElementClick(addedWidgetGridItem.key);
      }
    }

  }
  
  const onDropDragOver = (e: DragOverEvent) => {
    if (!dragItem) return;
    return { w: dragItem.widgetSize.minW, h: dragItem.widgetSize.minH }
  }

  function handleLayoutChange(layouts: Layout[]) {
    if (!layouts.length) return;
    if (projectStore.isReadonly) {
      for (const layout of layouts)
      layout.static = true;
    }

    if (initialLayout.length == 0) {
        projectStore.dispatchPages({
          type: ARUActionTypes.UPDATE,
          index: currentPageNo.current, payload: { layouts }
        })
    } else if (layouts.length == initialLayout.length) {
      setinitialLayout([]);
      }
  }

  function selectGridItem(gridItem: HTMLDivElement) {
    setTimeout(() => {
      setSelectedGridItemDomElement(gridItem);
    }, 0);
  }

  function handleDragStop(
    _layout: Layout[], 
    _oldItem: Layout,
    newItem: Layout,
    _placeholder: Layout,
    _e: globalThis.MouseEvent,
    element: HTMLElement) {
      if (projectStore.isReadonly) return;
      const page = currentPage();

      if (!page) return;
      const key = newItem.i;
      const widget = page.reportWidgets.find(widget => widget.key === key);

      if (!widget)return;
      const gridItem = getGridItemElement(element);
      if (gridItem) selectGridItem(gridItem);
      setSelectedWidget(widget);
  }

  function handleDragStart() {
    if (projectStore.isReadonly) return;
    setSelectedGridItemDomElement(undefined);
  }

  function handleResizeStart() {
    if (projectStore.isReadonly) return;
    setSelectedGridItemDomElement(undefined);
  }

  const handleResizeStop: ItemCallback = (
    _layout: Layout[], 
    _oldItem: Layout,
    newItem: Layout,
    _placeholder: Layout,
    _e: globalThis.MouseEvent,
    element: HTMLElement) => {
    if (projectStore.isReadonly) return;
    const page = currentPage();

    if (!page) return;
    const key = newItem.i;
    const widget = page.reportWidgets.find(widget => widget.key === key);

    if (!widget)return;
    
    const gridItem = getGridItemElement(element);
    if (gridItem) selectGridItem(gridItem);
    setSelectedWidget(widget);
  }

  const widgetDragHandler = useCallback(function(widget: ReportWidget) {
    setDragItem(widget);
  }, []);

  function handlePageInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = parseInt(e.target.value);
    if (isNaN(value) || value < 1 || value > projectStore.pages.length)
      return;
    setSelectedPage(value);
    loadPage(value - 1);
  }

  const bindDocClickHandler = useCallback(function bindDocClickHandler(e: Event) {
    if (getGridItemElement(e.target as HTMLElement) !== undefined ||
      elementIsWidgetPanel(e.target as HTMLElement)) {
      return;
    }
    setSelectedGridItemDomElement(undefined)
    setSelectedWidget(null);
    setShowPropertiesDialog(false);
  }, []);

  useEffect(() => {
    if (mounted.current) // workaround React Strict mode 2x useEffect call
      return;
    if (projectStore.pages.length == 0) {
      // auto create new page if no pages
      handleAddPageClick()
    } else {
      loadPage(0);
    }
    return () => { mounted.current = true }
  }, [])

  // update report context if global variables updated
  useEffect(() => {
    const page = currentPage();
    if (!page)
      return;
    // update global variables
    const state = {...widgetDataContext};
    for (const reportWidget of page.reportWidgets) {
      if (reportWidget.properties) {
        const properties2: Record<string, string> = {};
        for (const [key, value] of Object.entries(reportWidget.properties)) {
          properties2[key] = projectStore.widgetProperties.getProperty(value);
        }
        if (state[reportWidget.key]) {
          state[reportWidget.key].properties = properties2;
        } else {
          state[reportWidget.key] = {
            properties: properties2,
          }
        }
      } 
    }
    setWidgetDataContext(state);
  }, [projectStore.globalVars, projectStore.projectInfo])

  useEffect(() => {
    document.removeEventListener('mousedown', bindDocClickHandler);
    if (showPropertiesDialog) return;
    if (selectedGridItemDomElement) {
      document.addEventListener('mousedown', bindDocClickHandler);
      return () => document.removeEventListener('mousedown', bindDocClickHandler);
    }
  }, [selectedGridItemDomElement, showPropertiesDialog]);

  const onAddPage = (pageNo: number) => {
    setShowAddPageDialog(false);
    handleAddPageClick(pageNo)
  }

  const onMovePage = (pageNo: number) => {
    console.log("onMovePage", currentPageNo.current, pageNo)
    setShowMovePageDialog(false);
    // if target index is same as current page no, no need to move
    if (currentPageNo.current == pageNo)
      return;
    if (pageNo < 0)
      pageNo = 0;
    else if (currentPageNo.current > pageNo)
      pageNo++;
    projectStore.dispatchPages({ type: ARUActionTypes.MOVE, index: currentPageNo.current, index2: pageNo })
    loadPage(pageNo);
  }

  return (
    <WidgetDataContext.Provider value={widgetDataContext}>
        <div className={styles.panelsAndCanvasContainer}>
          <DesignerLeftPanel projectStore={projectStore} onWidgetDragStart={widgetDragHandler} />
          <div id="designArea" className={styles.designArea}>
            <div className={styles.designColumn} style={{ marginTop: '24px', marginBottom: '15px' }}>
              {isTemplate ? <h3 className='screenHeading'>Design Report Template</h3> : <h3 className='screenHeading'>Design Report</h3>}
              <p className='headingDescription'>Drag report widgets from the left panel onto the design canvas.</p>
            </div>
            <ErrorBoundary FallbackComponent={CanvasErrorFallback}>
              <div className={styles.designColumn}>
                <div className={styles.canvas_topbar}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <IconButton iconComponent={GridOnIcon} noOutline onClick={handleGridToggleClick} />
                    <IconButton iconComponent={DeleteIcon} noOutline disabled={projectStore.isReadonly} onClick={handleDeletePageClick} />
                    <IconButton iconComponent={AddIcon} noOutline disabled={projectStore.isReadonly} onClick={() => setShowAddPageDialog(true)} />
                    <IconButton iconComponent={OpenWithIcon} noOutline disabled={projectStore.isReadonly} onClick={() => setShowMovePageDialog(true)} />
                  </div>
                  <div className={styles.paginationBar}>
                    <div style={{ paddingRight: '5px'}}>Page: </div>
                    {projectStore.pages.length > 7 ? <OutlinedInput 
                      style={{
                        width: '35px',
                        height: '24px',
                        padding: '0 2px',
                        textAlign: 'center',
                        fontSize: '14px',
                        marginRight: '10px'
                      }}
                      inputProps={{
                        style: { padding: 0, textAlign: 'center' }
                      }}
                      onChange={handlePageInputChange}
                    /> : null}
                    <Pagination
                      count={projectStore.pages.length}
                      page={currentPageNo.current + 1}
                      onChange={onChangePage}
                      color="secondary" size="small" showFirstButton showLastButton
                    />
                  </div>
                </div>
              </div>
              <div ref={canvasRef}
                className={clsx(
                  styles.canvas,
                  sharedStyles.reportRoot,
                  sharedStyles.reportContainer,
                  sharedStyles.reportHeight
                )}>
                {showGridLines ? <div className={styles.canvas_grid} /> : null}
                {selectedGridItemDomElement ? <SelectedGridItemBoxOutline el={selectedGridItemDomElement}/> : null}
                {showGridItemActionMenu && selectedGridItemDomElement ?
                  <SelectedGridActionButtons
                    el={selectedGridItemDomElement}
                    hideEditBtn={!selectedWidgetHasProperties}
                    onDeleteClick={handleDeleteWidgetClick}
                    onEditClick={handleEditWidgetClick}/> : null}
                  <GridLayout
                    layout={gridLayouts}
                    width={GRID_WIDTH}
                    rowHeight={GRID_ROW_HEIGHT}
                    maxRows={GRID_MAX_ROWS}
                    margin={[0, 0]}
                    compactType={null}
                    onDrop={onDrop}
                    onDragStart={handleDragStart}
                    onDragStop={handleDragStop}
                    onResizeStart={handleResizeStart}
                    onDropDragOver={onDropDragOver}
                    onLayoutChange={handleLayoutChange}
                    onResizeStop={handleResizeStop}
                    preventCollision
                    isDroppable={!projectStore.isReadonly}
                    isResizable={!projectStore.isReadonly}
                    isBounded
                    resizeHandles={['s','w','e','n','sw','nw','se','ne']}
                    style={GRID_STRICT_STYLE}>
                    {currentPage()?.reportWidgets?.map(item => (projectStore.reportWidgetComponents[item.key]))}
                  </GridLayout>
              </div>
            </ErrorBoundary>
          </div>
          <DesignerRightPanel projectStore={projectStore}>
            <WidgetPropertiesPanel
              layout={selectedGridItemLayout}
              reportWidget={selectedWidget}
              onVisualStylePropertyChange={handleVisualStylePropertyChange} />
          </DesignerRightPanel>
        </div>
          
      {showPropertiesDialog && selectedWidget ? <WidgetDataPopulationDialog
        defaultPosition={dataPopulationDialogPosition}
        reportWidget={selectedWidget}
        combinedGlobalVars={combinedGlobalVars}
        getPropertyValueFn={projectStore.widgetProperties.getProperty}
        onClose={handlePropertiesClose}
        onChangeProperty={handleChangeProperty}
      /> : null}
      {showAddPageDialog && <AddPageDialog projectStore={projectStore} onAddPage={onAddPage} onCancel={() => setShowAddPageDialog(false)} />}
      {showMovePageDialog && <MovePageDialog projectStore={projectStore} onMovePage={onMovePage} onCancel={() => setShowMovePageDialog(false)} />}
      {showDeleteConfirmation ? 
        <ConfirmationDialog
          title='Delete Page'
          message='Are you sure you want to delete this page?'
          onClose={onDeletePageConfirmationClose}
        /> : null
      }
      {/* {projectStore.projectMode && (
        <ProjectTemplateInformationDialog
          projectStore={projectStore}
          open={showSaveAsTemplateDialog}
          onClose={handleCloseSaveAsTemplate}
        />
      )} */}
    </WidgetDataContext.Provider>
  )
}