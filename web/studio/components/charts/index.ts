// Barrel for the installed bklit chart components (MIT, github.com/bklit/bklit-ui).
// Mirrors upstream src/charts/index.ts, limited to the files present in this folder.
export {
  GradientDarkgreenGreen,
  GradientLightgreenGreen,
  GradientOrangeRed,
  GradientPinkBlue,
  GradientPinkRed,
  GradientPurpleOrange,
  GradientPurpleTeal,
  GradientSteelPurple,
  GradientTealBlue,
  LinearGradient,
  RadialGradient,
} from "@visx/gradient";
export {
  DEFAULT_ANIMATION_DURATION_MS,
  DEFAULT_ANIMATION_EASING,
  DEFAULT_CHART_ENTER_TRANSITION,
} from "./animation";
export { Area, type AreaProps } from "./area";
export { AreaChart, type AreaChartProps } from "./area-chart";
export {
  AreaChartLoading,
  type AreaChartLoadingProps,
} from "./area-chart-loading";
export { Background, type BackgroundProps } from "./background";
export {
  Bar,
  type BarAnimationType,
  type BarLineCap,
  type BarProps,
} from "./bar";
export { BarChart, type BarChartProps, type BarOrientation } from "./bar-chart";
export {
  BarChartLoading,
  type BarChartLoadingProps,
} from "./bar-chart-loading";
export {
  BarColumnTrack,
  type BarColumnTrackProps,
  BarSquares,
  type BarSquaresProps,
  type GradientStop,
} from "./bar-squares";
export {
  computeSquareColumn,
  type SquareColumnLayout,
  topSquareCenterY,
} from "./bar-squares-layout";
export { BarXAxis, type BarXAxisProps } from "./bar-x-axis";
export { BarYAxis, type BarYAxisProps } from "./bar-y-axis";
export {
  chartCenterContainerClassName,
  chartCenterLabelClassName,
  chartCenterValueClassName,
} from "./chart-center-typography";
export { CHART_CLIP_PASSTHROUGH } from "./chart-child-passthrough";
export {
  ChartConfigProvider,
  type ChartConfigProviderProps,
  type ChartConfigValue,
  DEFAULT_CHART_CONFIG,
  resolveTooltipBoxMotion,
  type SpringConfig,
  useChartConfig,
} from "./chart-config-context";
export {
  type ChartContextValue,
  type ChartHoverContextValue,
  ChartProvider,
  type ChartStableContextValue,
  chartCssVars,
  defaultScatterColors,
  type LineConfig,
  type Margin,
  type TooltipData,
  useChart,
  useChartHover,
  useChartStable,
  useYScale,
} from "./chart-context";
export {
  ChartLegendHoverProvider,
  useChartLegendHover,
} from "./chart-legend-hover";
export {
  ChartLoadingLabel,
  type ChartLoadingLabelProps,
} from "./chart-loading-label";
export {
  type ChartPhase,
  type ChartStatus,
  DEFAULT_CHART_LIFECYCLE,
  DEFAULT_CHART_STATUS,
  DEFAULT_Y_DOMAIN_TWEEN_MS,
  isChartInteractionPhase,
  type LoadingStyle,
  resolveRestingChartPhase,
} from "./chart-phase";
export {
  ChartRevealClip,
  type ChartRevealClipProps,
} from "./chart-reveal-clip";
export {
  CHART_SCALE_VARS,
  type ChartScaleVars,
  chartScaleCssVars,
} from "./chart-scale";
export {
  ChartStatFlow,
  type ChartStatFlowFormat,
  type ChartStatFlowProps,
  defaultChartStatFlowFormat,
} from "./chart-stat-flow";
export {
  FunnelChart,
  type FunnelChartProps,
  type FunnelGradientStop,
  type FunnelStage,
} from "./funnel-chart";
export { Gauge, type GaugeOrientation, type GaugeProps } from "./gauge";
export type {
  GaugeLabelAlign,
  GaugeLabelPlacement,
} from "./gauge-label-layout";
export {
  type GenerateChartSkeletonDataOptions,
  generateChartSkeletonData,
} from "./generate-chart-skeleton-data";
export { Grid, type GridProps } from "./grid";
export {
  buildHeatmapColorScale,
  buildHeatmapColorScaleFromStyles,
  buildHeatmapFillScale,
  buildHeatmapLegendGradient,
  buildHeatmapRowOpacity,
  defaultHeatmapColorScale,
  defaultHeatmapFillScale,
  filterHeatmapColumns,
  formatHeatmapContributionLabel,
  formatHeatmapTooltipDate,
  formatHeatmapTooltipWeekday,
  formatHeatmapYAxisLabel,
  getHeatmapCalendarRangeStart,
  getHeatmapColumnMonthAnchor,
  getHeatmapDayLabels,
  getHeatmapSeparatorColumnIndices,
  getHeatmapTimeExtent,
  getHeatmapWeekCount,
  getHeatmapWeekStartAlignedToRange,
  getHeatmapWeekStartSunday,
  getHeatmapYearStartMonth,
  HEATMAP_DAY_LABELS,
  HEATMAP_DEFAULT_LEVEL_COLORS,
  HEATMAP_DEFAULT_LEVEL_STYLES,
  HEATMAP_LEGEND_LEVELS,
  HEATMAP_MONTHS_ONE_YEAR,
  HEATMAP_MONTHS_SIX,
  HEATMAP_WEEKS_ONE_YEAR,
  type HeatmapBin,
  HeatmapCells,
  type HeatmapCellsProps,
  HeatmapChart,
  HeatmapChartLoading,
  type HeatmapChartLoadingProps,
  type HeatmapChartProps,
  type HeatmapColumn,
  type HeatmapContextValue,
  HeatmapInteractionBoundary,
  HeatmapInteractionProvider,
  type HeatmapLayout,
  HeatmapLegend,
  type HeatmapLegendProps,
  type HeatmapLegendVariant,
  type HeatmapLevelColors,
  type HeatmapLevelFillMode,
  type HeatmapLevelStyle,
  type HeatmapLevelStyles,
  HeatmapProvider,
  HeatmapSeparator,
  type HeatmapSeparatorProps,
  HeatmapTooltip,
  type HeatmapTooltipProps,
  type HeatmapWeekRange,
  type HeatmapWeekStartDay,
  HeatmapXAxis,
  type HeatmapXAxisProps,
  HeatmapYAxis,
  type HeatmapYAxisLabelFormat,
  type HeatmapYAxisProps,
  type HeatmapYAxisTickFilter,
  heatmapCssVars,
  heatmapLevelPatternId,
  inferHeatmapCalendarRangeStart,
  isHeatmapLevelPattern,
  levelColorsFromStyles,
  levelStylesFromColors,
  resolveHeatmapLevelStyles,
  resolveHeatmapWeekRange,
  shouldShowHeatmapYAxisTick,
  useHeatmap,
} from "./heatmap";
export {
  type IndicatorFadeEdges,
  indicatorFadeGradientStops,
  resolveVerticalFadeSides,
} from "./indicator-fade";
export {
  Legend,
  type LegendContextValue,
  LegendItem as LegendItemComponent,
  type LegendItemContextValue,
  type LegendItemData,
  type LegendItemProps,
  LegendLabel,
  type LegendLabelProps,
  LegendMarker,
  type LegendMarkerProps,
  LegendProgress,
  type LegendProgressProps,
  type LegendProps,
  LegendValue,
  type LegendValueProps,
  legendCssVars,
  useLegend,
  useLegendItem,
} from "./legend";
export { Line, type LineProps } from "./line";
export { LineChart, type LineChartProps } from "./line-chart";
export {
  LineChartLoading,
  type LineChartLoadingProps,
} from "./line-chart-loading";
export {
  type LineLoadingPulseMode,
  LineLoadingPulseStroke,
  type LineLoadingPulseStrokeProps,
  resolveLineLoadingPulseMode,
} from "./line-loading-pulse";
export {
  LineSeriesTerminalMarker,
  type LineSeriesTerminalMarkerProps,
} from "./line-series-terminal-marker";
export {
  BarLoadingSkeleton,
  type BarLoadingSkeletonProps,
  getSkeletonHeights,
  LineLoadingSweep,
  type LineLoadingSweepProps,
} from "./loading-sweep";
export { PatternArea, type PatternAreaProps } from "./pattern-area";
export {
  isCirclePattern,
  isCirclesPattern,
  PATTERN_PRESET_IDS,
  type PatternPresetId,
  type PatternPresetOptions,
  patternPresetTileSize,
  renderPatternPreset,
} from "./pattern-preset";
export { PieCenter, type PieCenterProps } from "./pie-center";
export {
  PieCenterShell,
  type PieCenterShellProps,
} from "./pie-center-shell";
export {
  DEFAULT_HOVER_OFFSET,
  PieChart,
  type PieChartProps,
} from "./pie-chart";
export {
  defaultPieColors,
  type PieArcData,
  type PieContextValue,
  type PieData,
  PieProvider,
  pieCssVars,
  usePie,
  usePieHover,
  usePieStable,
} from "./pie-context";
export {
  PieSlice,
  type PieSliceHoverEffect,
  type PieSliceProps,
} from "./pie-slice";
export {
  extractProjectionLineConfigs,
  mergeProjectionXDomainMax,
  mergeProjectionYDomain,
  type ProjectionLineConfig,
} from "./projection-config";
export {
  ProjectionLine,
  type ProjectionLineProps,
  type ProjectionStrokeStyle,
} from "./projection-line";
export {
  ProjectionLineEndMarker,
  type ProjectionLineEndMarkerProps,
} from "./projection-line-end-marker";
export {
  type BuildProjectionPathOptions,
  buildHorizontalTangentBezierPath,
  buildProjectionPath,
  computeProjectionAnchorTangentSlope,
  type ProjectionAutoMethod,
  type ProjectionCurveKind,
  type ProjectionMode,
  type ProjectionPathDensity,
  type ProjectionPoint,
  projectionDateExtents,
  projectionValueExtents,
} from "./projection-utils";
export { RadarArea, type RadarAreaProps } from "./radar-area";
export { RadarAxis, type RadarAxisProps } from "./radar-axis";
export { RadarChart, type RadarChartProps } from "./radar-chart";
export {
  defaultRadarColors,
  type RadarContextValue,
  type RadarData,
  type RadarMetric,
  RadarProvider,
  radarCssVars,
  useRadar,
  useRadarHover,
  useRadarStable,
} from "./radar-context";
export { RadarGrid, type RadarGridProps } from "./radar-grid";
export { RadarLabels, type RadarLabelsProps } from "./radar-labels";
export {
  computeReferenceAreaRect,
  type ReferenceAreaIfOverflow,
  type ReferenceAreaRect,
} from "./reference-area-geometry";
export { Ring, type RingLineCap, type RingProps } from "./ring";
export { RingCenter, type RingCenterProps } from "./ring-center";
export { RingChart, type RingChartProps } from "./ring-chart";
export {
  defaultRingColors,
  type RingContextValue,
  type RingData,
  RingProvider,
  ringCssVars,
  useRing,
  useRingHover,
  useRingStable,
} from "./ring-context";
export {
  SankeyChart,
  type SankeyChartProps,
  type SankeyContextValue,
  type SankeyData,
  type SankeyLabelOrientation,
  SankeyLink,
  type SankeyLinkDatum,
  type SankeyLinkProps,
  SankeyNode,
  type SankeyNodeDatum,
  type SankeyNodeProps,
  SankeyProvider,
  SankeyTooltip,
  type SankeyTooltipData,
  type SankeyTooltipProps,
  sankeyCssVars,
  useSankey,
} from "./sankey";
export { Scatter, type ScatterProps } from "./scatter";
export { ScatterChart, type ScatterChartProps } from "./scatter-chart";
export {
  SeriesMarkers,
  type SeriesMarkersProps,
} from "./series-markers";
export {
  getSeriesMarkerVisualExtent,
  SeriesPointMarker,
  type SeriesPointMarkerProps,
  type SeriesPointMarkerStyle,
} from "./series-point-marker";
export {
  StaticChartPreviewProvider,
  useStaticChartPreview,
} from "./static-chart-preview-context";
export {
  ChartTooltip,
  type ChartTooltipProps,
  DateTicker,
  type DateTickerProps,
  type IndicatorWidth,
  TooltipBox,
  type TooltipBoxProps,
  TooltipContent,
  type TooltipContentProps,
  TooltipDot,
  type TooltipDotProps,
  TooltipIndicator,
  type TooltipIndicatorProps,
  type TooltipRow,
} from "./tooltip";
export { useAnimatedYDomains } from "./use-animated-y-domains";
export {
  type ChartSelection,
  useChartInteraction,
} from "./use-chart-interaction";
export {
  PatternCircles,
  PatternHexagons,
  PatternLines,
  PatternWaves,
} from "./visx-pattern";
export { XAxis, type XAxisProps } from "./x-axis";
export { YAxis, type YAxisProps } from "./y-axis";
export {
  DEFAULT_Y_AXIS_ID,
  getPrimaryYScale,
  type YAxisOrientation,
} from "./y-axis-scales";
export {
  resolveYAxisTickCount,
  Y_AXIS_DEFAULT_TICK_COUNT,
  Y_AXIS_MAX_TICK_COUNT,
  Y_AXIS_MIN_TICK_COUNT,
} from "./y-axis-ticks";
export {
  computeYDomainsByAxis,
  isLoadingChromePhase,
  isYDomainTweenPhase,
  mergeYDomainRecords,
  niceYDomain,
  shouldTweenYDomain,
  type YDomain,
} from "./y-domain-utils";
