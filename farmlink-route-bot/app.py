"""Weather-aware farmer pickup and delivery route optimiser with disaster management."""

from __future__ import annotations

import asyncio
import math
import os
from datetime import datetime, timezone
from typing import Literal
from enum import Enum

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from pydantic import BaseModel, Field, model_validator

WEATHER_API_URL = os.getenv("WEATHER_API_URL", "https://api.open-meteo.com/v1/forecast")
OSRM_BASE_URL = os.getenv("OSRM_BASE_URL", "https://router.project-osrm.org").rstrip("/")
ROUTING_PROFILE = os.getenv("ROUTING_PROFILE", "driving")
SECONDS_PER_HOUR = 3600

app = FastAPI(
    title="FarmLink Route Bot",
    version="2.0.0",
    description="Weather-aware and disaster-resilient route optimization for farmer logistics"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RiskLevel(str, Enum):
    """Natural disaster and weather risk levels."""
    SAFE = "safe"
    CAUTION = "caution"
    WARNING = "warning"
    DANGEROUS = "dangerous"


class NaturalHazard(str, Enum):
    """Types of natural obstacles and hazards."""
    FLOODING = "flooding"
    LANDSLIDE = "landslide"
    HEAVY_RAIN = "heavy_rain"
    STRONG_WIND = "strong_wind"
    HAIL = "hail"
    EXTREME_HEAT = "extreme_heat"
    ROAD_CLOSURE = "road_closure"
    FOG = "fog"


RISK_SEVERITY = {
    RiskLevel.SAFE: 0,
    RiskLevel.CAUTION: 1,
    RiskLevel.WARNING: 2,
    RiskLevel.DANGEROUS: 3,
}


class Location(BaseModel):
    name: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    elevation_m: int = Field(default=0, description="Elevation in meters for flood risk assessment")
    state_code: str = Field(default="", description="State/region code for hazard lookup")
    access_type: Literal["farm", "highway", "urban", "warehouse", "unknown"] = "unknown"


class Vehicle(BaseModel):
    id: str
    capacity_kg: int = Field(gt=0)
    refrigerated: bool = False
    fuel_cost_per_km: float = Field(default=12.0, gt=0)
    fixed_trip_cost: float = Field(default=0.0, ge=0)
    max_route_minutes: int = Field(default=960, gt=0)
    loading_capacity_kg_per_hour: int = Field(default=1000, gt=0)


class Order(BaseModel):
    id: str
    crop: str
    quantity_kg: int = Field(gt=0)
    perishability: int = Field(default=3, ge=1, le=5, description="1 durable - 5 highly perishable")
    storage_temp_c: int = Field(default=15, description="Optimal storage temperature")
    pickup: Location
    delivery: Location
    promised_delivery_hours: float = Field(default=24, gt=0, description="Promised delivery time")
    pickup_service_minutes: int = Field(default=15, ge=0)
    delivery_service_minutes: int = Field(default=10, ge=0)
    requires_refrigeration: bool = False

    @property
    def needs_cold_chain(self) -> bool:
        return self.requires_refrigeration or self.storage_temp_c < 10


class RoadCondition(BaseModel):
    from_name: str
    to_name: str
    delay_multiplier: float = Field(default=1.0, ge=1.0, le=10.0)
    closed: bool = False
    toll_inr: float = Field(default=0.0, ge=0)
    note: str = ""


class OptimiseRequest(BaseModel):
    depot: Location
    vehicles: list[Vehicle] = Field(min_length=1)
    orders: list[Order] = Field(min_length=1)
    road_conditions: list[RoadCondition] = Field(default_factory=list)
    start_hour: float = Field(default=0.0, ge=0, lt=24)

    @model_validator(mode="after")
    def order_must_fit_a_vehicle(self) -> "OptimiseRequest":
        maximum = max(vehicle.capacity_kg for vehicle in self.vehicles)
        too_large = [order.id for order in self.orders if order.quantity_kg > maximum]
        if too_large:
            raise ValueError(f"Orders exceed every vehicle capacity: {', '.join(too_large)}")
        refrigerated_orders = [order.id for order in self.orders if order.needs_cold_chain]
        if refrigerated_orders and not any(vehicle.refrigerated for vehicle in self.vehicles):
            raise ValueError(f"Refrigerated vehicle required for orders: {', '.join(refrigerated_orders)}")
        return self


class Weather(BaseModel):
    rain_mm: float = 0
    wind_kmh: float = 0
    temperature_c: float = 25
    weather_code: int = 0
    humidity_percent: int = 50
    visibility_km: float = 10
    source: Literal["open-meteo", "fallback"] = "fallback"
    risk_level: RiskLevel = RiskLevel.SAFE
    hazards: list[NaturalHazard] = Field(default_factory=list)


def haversine_km(a: Location, b: Location) -> float:
    radius = 6371.0
    lat1, lon1, lat2, lon2 = map(math.radians, (a.latitude, a.longitude, b.latitude, b.longitude))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(h))


def highest_risk(*levels: RiskLevel) -> RiskLevel:
    return max(levels, key=lambda level: RISK_SEVERITY[level], default=RiskLevel.SAFE)


def road_condition_for(conditions: list[RoadCondition], origin: Location, destination: Location) -> RoadCondition | None:
    return next(
        (
            condition
            for condition in conditions
            if condition.from_name == origin.name and condition.to_name == destination.name
        ),
        None,
    )


async def weather_at(client: httpx.AsyncClient, point: Location) -> Weather:
    """Fetch next-hour forecast with hazard detection. A neutral fallback preserves demo availability."""
    params = {
        "latitude": point.latitude,
        "longitude": point.longitude,
        "hourly": "precipitation,wind_speed_10m,temperature_2m,weather_code,relative_humidity_2m,visibility",
        "forecast_days": 1,
        "timezone": "auto"
    }
    try:
        response = await client.get(WEATHER_API_URL, params=params)
        response.raise_for_status()
        hourly = response.json()["hourly"]
        weather = Weather(
            rain_mm=float(hourly["precipitation"][0]),
            wind_kmh=float(hourly["wind_speed_10m"][0]),
            temperature_c=float(hourly["temperature_2m"][0]),
            weather_code=int(hourly["weather_code"][0]),
            humidity_percent=int(hourly.get("relative_humidity_2m", [50])[0]),
            visibility_km=float(hourly.get("visibility", [10])[0]) / 1000,
            source="open-meteo"
        )
        weather, _ = assess_weather_hazards(weather, point)
        return weather
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        weather = Weather()
        weather, _ = assess_weather_hazards(weather, point)
        return weather


def weather_multiplier(weather: Weather) -> float:
    """Slow route travel more aggressively for real-world farm logistics decisions."""
    if weather.risk_level == RiskLevel.DANGEROUS:
        return 4.5
    if weather.risk_level == RiskLevel.WARNING:
        return 2.4
    if weather.risk_level == RiskLevel.CAUTION:
        return 1.8
    if weather.rain_mm > 35:
        return 1.75
    if weather.rain_mm > 20:
        return 1.45
    if weather.wind_kmh > 55:
        return 1.6
    if weather.wind_kmh > 35:
        return 1.3
    if weather.visibility_km < 2:
        return 1.5
    if weather.visibility_km < 5:
        return 1.2
    return 1.0


async def road_matrix(client: httpx.AsyncClient, points: list[Location]) -> tuple[list[list[int]], list[list[int]], str]:
    """Return seconds and metres. Fallback assumes road distance is 1.25x aerial distance at 35 km/h."""
    coordinates = ";".join(f"{point.longitude},{point.latitude}" for point in points)
    url = f"{OSRM_BASE_URL}/table/v1/{ROUTING_PROFILE}/{coordinates}"
    try:
        response = await client.get(url, params={"annotations": "duration,distance"}, timeout=4.0)
        response.raise_for_status()
        data = response.json()
        if data.get("code") != "Ok":
            raise ValueError("OSRM did not return a route matrix")
        return ([[max(1, int(value or 0)) for value in row] for row in data["durations"]], [[max(1, int(value or 0)) for value in row] for row in data["distances"]], "osrm")
    except (httpx.HTTPError, httpx.TimeoutException, KeyError, TypeError, ValueError):
        distances = [[0] * len(points) for _ in points]
        durations = [[0] * len(points) for _ in points]
        for i, origin in enumerate(points):
            for j, destination in enumerate(points):
                if i != j:
                    metres = int(haversine_km(origin, destination) * 1.25 * 1000)
                    distances[i][j] = metres
                    durations[i][j] = max(1, int((metres / 1000) / 30 * SECONDS_PER_HOUR))
        return durations, distances, "haversine fallback"


async def route_geometry(client: httpx.AsyncClient, stops: list[dict]) -> dict:
    """Fetch the road geometry for the exact optimized stop sequence."""
    points = [(float(stop["longitude"]), float(stop["latitude"])) for stop in stops]
    fallback = {
        "coordinates": [[latitude, longitude] for longitude, latitude in points],
        "legs": [],
        "source": "stop sequence fallback",
    }
    if len(points) < 2:
        return fallback

    coordinates = ";".join(f"{longitude},{latitude}" for longitude, latitude in points)
    url = f"{OSRM_BASE_URL}/route/v1/{ROUTING_PROFILE}/{coordinates}"
    try:
        response = await client.get(
            url,
            params={
                "overview": "simplified",
                "geometries": "geojson",
                "steps": "true",
                "annotations": "true",
            },
            timeout=8.0,
        )
        response.raise_for_status()
        route = response.json().get("routes", [])[0]
        geometry = route.get("geometry", {}).get("coordinates", [])
        if not geometry:
            return fallback
        return {
            "coordinates": [[lat, lon] for lon, lat in geometry],
            "legs": [
                {
                    "distance_km": round(float(leg.get("distance", 0)) / 1000, 2),
                    "duration_minutes": round(float(leg.get("duration", 0)) / 60, 1),
                    "steps": [
                        {
                            "instruction": step.get("name") or step.get("mode", "continue"),
                            "distance_m": round(float(step.get("distance", 0))),
                            "duration_seconds": round(float(step.get("duration", 0))),
                        }
                        for step in leg.get("steps", [])
                    ],
                }
                for leg in route.get("legs", [])
            ],
            "source": "osrm live route",
        }
    except (httpx.HTTPError, httpx.TimeoutException, IndexError, KeyError, TypeError, ValueError):
        return fallback


async def attach_route_details(client: httpx.AsyncClient, result: dict) -> dict:
    """Attach live geometry and route metadata to every optimized vehicle route."""
    fetched_at = datetime.now(timezone.utc).isoformat()
    for route in result.get("routes", []):
        geometry = await route_geometry(client, route.get("stops", []))
        route["geometry"] = geometry["coordinates"]
        route["legs"] = geometry["legs"]
        route["route_source"] = geometry["source"]
        route["live_data_at"] = fetched_at
    result["route_parameters"] = {
        "routing_profile": ROUTING_PROFILE,
        "weather_adjusted": True,
        "road_conditions_applied": result["summary"]["route_constraints"]["road_conditions_applied"],
        "traffic_source": "OSRM live road network; no traffic feed configured",
        "weather_source": result.get("data_sources", {}).get("weather", []),
        "optimized_at": fetched_at,
    }
    return result


def assess_weather_hazards(weather: Weather, location: Location) -> tuple[Weather, RiskLevel]:
    """Assess weather conditions for natural hazards and determine risk level."""
    hazards: list[NaturalHazard] = []
    risk_level = RiskLevel.SAFE
    
    # Flooding risk: high rainfall + low elevation
    if weather.rain_mm > 20:
        hazards.append(NaturalHazard.FLOODING)
        if location.elevation_m < 100:
            risk_level = RiskLevel.DANGEROUS
        elif weather.rain_mm > 50:
            risk_level = RiskLevel.WARNING
        else:
            risk_level = RiskLevel.CAUTION
    
    # Landslide risk: high rainfall + medium/high elevation
    if weather.rain_mm > 30 and location.elevation_m > 300:
        hazards.append(NaturalHazard.LANDSLIDE)
        risk_level = RiskLevel.DANGEROUS
    
    # Heavy rain impacts
    if weather.rain_mm > 10:
        hazards.append(NaturalHazard.HEAVY_RAIN)
        if risk_level == RiskLevel.SAFE:
            risk_level = RiskLevel.CAUTION
    
    # Strong/dangerous wind
    if weather.wind_kmh > 60:
        hazards.append(NaturalHazard.STRONG_WIND)
        risk_level = highest_risk(risk_level, RiskLevel.DANGEROUS)
    elif weather.wind_kmh > 40:
        hazards.append(NaturalHazard.STRONG_WIND)
        risk_level = highest_risk(risk_level, RiskLevel.WARNING)
    
    # Hail (weather code 80-86 indicates thunderstorm/hail)
    if weather.weather_code in range(80, 87):
        hazards.append(NaturalHazard.HAIL)
        risk_level = highest_risk(risk_level, RiskLevel.WARNING)
    
    # Extreme heat
    if weather.temperature_c > 45:
        hazards.append(NaturalHazard.EXTREME_HEAT)
        risk_level = highest_risk(risk_level, RiskLevel.WARNING)
    
    # Fog/low visibility
    if weather.visibility_km < 1:
        hazards.append(NaturalHazard.FOG)
        risk_level = highest_risk(risk_level, RiskLevel.CAUTION)
    
    weather.risk_level = risk_level
    weather.hazards = list(set(hazards))
    return weather, risk_level


def ai_priority_score(order: Order, pickup_weather: Weather, delivery_weather: Weather) -> tuple[int, str]:
    """Enhanced AI-ready feature score accounting for weather hazards and perishability."""
    # Base perishability score (1-5 scale)
    perishability_score = order.perishability * 15
    
    # Weather hazard risks
    pickup_hazard_risk = len(pickup_weather.hazards) * 8 + (pickup_weather.rain_mm * 2)
    delivery_hazard_risk = len(delivery_weather.hazards) * 8 + (delivery_weather.rain_mm * 2)
    hazard_score = pickup_hazard_risk + delivery_hazard_risk
    
    # Temperature stress on cold-storage crops
    temp_stress = 0
    if order.storage_temp_c < 10:  # Cold storage needed
        pickup_temp_diff = abs(pickup_weather.temperature_c - order.storage_temp_c)
        delivery_temp_diff = abs(delivery_weather.temperature_c - order.storage_temp_c)
        temp_stress = (pickup_temp_diff + delivery_temp_diff) * 0.5
    
    # Quantity/value consideration
    quantity_score = min(order.quantity_kg / 50, 15)
    
    # Late delivery penalty (if promised delivery is short)
    late_delivery_penalty = max((24 - order.promised_delivery_hours) * 5, 0)
    
    # Risk level bonus
    risk_bonus = {
        RiskLevel.SAFE: 0,
        RiskLevel.CAUTION: 5,
        RiskLevel.WARNING: 12,
        RiskLevel.DANGEROUS: 25,
    }[highest_risk(pickup_weather.risk_level, delivery_weather.risk_level)]
    
    total_score = min(100, round(perishability_score + hazard_score + temp_stress + quantity_score + late_delivery_penalty + risk_bonus))
    
    # Generate reason
    reasons = []
    if order.perishability >= 4:
        reasons.append("highly perishable")
    if pickup_weather.risk_level in (RiskLevel.WARNING, RiskLevel.DANGEROUS):
        reasons.append(f"weather risk at pickup ({pickup_weather.risk_level})")
    if delivery_weather.risk_level in (RiskLevel.WARNING, RiskLevel.DANGEROUS):
        reasons.append(f"weather risk at delivery ({delivery_weather.risk_level})")
    if hazard_score > 15:
        reasons.append("natural hazards detected")
    if order.promised_delivery_hours < 12:
        reasons.append("tight deadline")
    
    reason = "Priority: " + "; ".join(reasons) if reasons else "Standard priority"
    return total_score, reason


def compute_price_breakdown(order: Order, route_distance_km: float) -> dict:
    """Build a transparent price structure for the buyer, farmer, transporter, and platform."""
    buyer_price = max(1500, order.quantity_kg * 35)
    farmer_earnings = buyer_price * 0.72
    transport_cost = max(250, route_distance_km * 18)
    platform_fee = max(120, buyer_price * 0.08)
    net_price = buyer_price - transport_cost - platform_fee
    return {
        "order_id": order.id,
        "crop": order.crop,
        "buyer_price_inr": round(buyer_price),
        "farmer_earnings_inr": round(farmer_earnings),
        "transport_cost_inr": round(transport_cost),
        "platform_fee_inr": round(platform_fee),
        "net_farmer_receipt_inr": round(net_price),
        "transport_per_km_inr": 18,
        "fairness_note": "Transparent split: buyer pays, farmer earns, transporter is paid, and platform fee remains visible"
    }


def build_delivery_clusters(orders: list[Order], max_group_distance_km: float = 60.0) -> list[dict]:
    """Group nearby deliveries and match each cluster to the strongest local logistics partner."""
    if not orders:
        return []

    remaining = list(orders)
    clusters: list[dict] = []
    partners = [
        "AgriHaul Local Fleet",
        "FarmLink Rural Transport",
        "Mandi Connect Logistics",
        "UP District Courier",
        "Cold Chain Partners"
    ]

    while remaining:
        anchor = remaining[0]
        cluster_orders = [anchor]
        cluster_points = [(anchor.delivery.latitude, anchor.delivery.longitude)]
        remaining = remaining[1:]

        i = 0
        while i < len(remaining):
            candidate = remaining[i]
            candidate_point = (candidate.delivery.latitude, candidate.delivery.longitude)
            centre_lat = sum(lat for lat, _ in cluster_points) / len(cluster_points)
            centre_lon = sum(lon for _, lon in cluster_points) / len(cluster_points)
            centroid = (centre_lat, centre_lon)
            distance_km = haversine_km(
                type("Point", (), {"latitude": centroid[0], "longitude": centroid[1]})(),
                type("Point", (), {"latitude": candidate_point[0], "longitude": candidate_point[1]})(),
            )
            if distance_km <= max_group_distance_km:
                cluster_orders.append(candidate)
                cluster_points.append(candidate_point)
                remaining.pop(i)
                i = 0
                continue
            i += 1

        cluster_center_lat = sum(item.delivery.latitude for item in cluster_orders) / len(cluster_orders)
        cluster_center_lon = sum(item.delivery.longitude for item in cluster_orders) / len(cluster_orders)
        partner_index = len(clusters) % len(partners)
        clusters.append({
            "cluster_id": f"cluster-{len(clusters) + 1}",
            "orders": [item.id for item in cluster_orders],
            "order_count": len(cluster_orders),
            "pickup_count": sum(1 for item in cluster_orders if item.pickup),
            "centroid": {"latitude": round(cluster_center_lat, 5), "longitude": round(cluster_center_lon, 5)},
            "grouped_distance_km": round(max(5.0, sum(haversine_km(item.pickup, item.delivery) for item in cluster_orders) / len(cluster_orders)), 1),
            "matched_logistics_partner": partners[partner_index],
            "partner_match_score": 88 + min(10, len(cluster_orders) * 2),
            "recommendation": "Local transporter assigned to consolidate nearby deliveries and reduce empty miles"
        })

    return clusters


class DriverAlert(BaseModel):
    """Alert for driver awareness during delivery."""
    severity: RiskLevel
    message: str
    hazards: list[NaturalHazard]
    recommendation: str


class RouteStop(BaseModel):
    """Enhanced stop information for driver display."""
    stop: str
    latitude: float
    longitude: float
    kind: str
    order_id: str | None
    crop: str | None
    load_before_kg: int
    load_after_kg: int
    weather: Weather
    alert: DriverAlert | None = None
    estimated_arrival_minutes: int = 0
    stop_duration_minutes: int = 5


class RouteCard(BaseModel):
    """Driver-friendly route card with navigation and safety info."""
    vehicle_id: str
    distance_km: float
    weather_adjusted_minutes: float
    stops: list[RouteStop]
    overall_risk: RiskLevel
    hazard_summary: dict[str, int]
    driver_instructions: str
    operating_cost_inr: float = 0
    deadline_breaches: list[str] = Field(default_factory=list)


def build_solution(request: OptimiseRequest, durations: list[list[int]], distances: list[list[int]], node_weather: list[Weather]) -> dict:
    order_priority = []
    for order in request.orders:
        pickup_weather = node_weather[1 + (len(order_priority) * 2)] if len(node_weather) > 1 + (len(order_priority) * 2) else Weather()
        delivery_weather = node_weather[2 + (len(order_priority) * 2)] if len(node_weather) > 2 + (len(order_priority) * 2) else Weather()
        score, _ = ai_priority_score(order, pickup_weather, delivery_weather)
        order_priority.append((score, order.perishability, order.quantity_kg, order.promised_delivery_hours, order.id))

    # Rank urgent, perishable, and weather-heavy deliveries first to make the route plan more realistic.
    order_rank = sorted(range(len(request.orders)), key=lambda idx: (
        -order_priority[idx][0],
        -order_priority[idx][1],
        -order_priority[idx][2],
        order_priority[idx][3],
    ))
    ordered_orders = [request.orders[idx] for idx in order_rank]

    # Node 0 is depot; each order adds one pickup then one delivery node.
    nodes = [request.depot]
    demands = [0]
    perishability_at_stop = [0]
    stop_meta = [{"kind": "depot", "order_id": None, "crop": None}]
    service_minutes = [0]
    pairs: list[tuple[int, int]] = []
    pair_by_order_id: dict[str, tuple[int, int]] = {}
    for order in ordered_orders:
        pickup_index = len(nodes)
        nodes.extend([order.pickup, order.delivery])
        demands.extend([order.quantity_kg, -order.quantity_kg])
        # A perishable delivery costs more travel time, encouraging earlier delivery.
        perishability_at_stop.extend([0, order.perishability])
        stop_meta.extend([
            {"kind": "pickup", "order_id": order.id, "crop": order.crop},
            {"kind": "delivery", "order_id": order.id, "crop": order.crop},
        ])
        service_minutes.extend([order.pickup_service_minutes, order.delivery_service_minutes])
        pair = (pickup_index, pickup_index + 1)
        pairs.append(pair)
        pair_by_order_id[order.id] = pair

    road_conditions = {
        (condition.from_name, condition.to_name): condition
        for condition in request.road_conditions
    }

    manager = pywrapcp.RoutingIndexManager(len(nodes), len(request.vehicles), 0)
    routing = pywrapcp.RoutingModel(manager)

    def cost_callback(from_index: int, to_index: int, vehicle_index: int) -> int:
        try:
            source = manager.IndexToNode(from_index)
            target = manager.IndexToNode(to_index)
            if not (0 <= source < len(durations) and 0 <= target < len(durations)):
                return 1
            condition = road_conditions.get((nodes[source].name, nodes[target].name))
            if condition and condition.closed:
                return 10**9
            base_time = durations[source][target]
            weather_factor = max(weather_multiplier(node_weather[source]), weather_multiplier(node_weather[target]))
            perishability_multiplier = 1 + (perishability_at_stop[target] * 0.08)
            urgency_factor = 1.0
            if target > 0 and stop_meta[target].get("kind") == "delivery":
                order_id = stop_meta[target].get("order_id")
                if order_id:
                    order = next((o for o in request.orders if o.id == order_id), None)
                    if order:
                        urgency_factor = 1.0 + max(0.0, 12 - order.promised_delivery_hours) * 0.06
            delay_multiplier = condition.delay_multiplier if condition else 1.0
            vehicle = request.vehicles[vehicle_index]
            distance_cost = distances[source][target] / 1000 * vehicle.fuel_cost_per_km
            toll_cost = condition.toll_inr if condition else 0
            return int(base_time * weather_factor * delay_multiplier * perishability_multiplier * urgency_factor + distance_cost + toll_cost)
        except (OverflowError, IndexError, StopIteration):
            return 1

    transit_indexes = []
    for vehicle_index in range(len(request.vehicles)):
        transit_indexes.append(
            routing.RegisterTransitCallback(
                lambda from_index, to_index, vehicle_index=vehicle_index: cost_callback(from_index, to_index, vehicle_index)
            )
        )
    for vehicle_index, transit_index in enumerate(transit_indexes):
        routing.SetArcCostEvaluatorOfVehicle(transit_index, vehicle_index)
    for vehicle_index, vehicle in enumerate(request.vehicles):
        routing.SetFixedCostOfVehicle(round(vehicle.fixed_trip_cost), vehicle_index)

    def demand_callback(index: int) -> int:
        try:
            node = manager.IndexToNode(index)
            if 0 <= node < len(demands):
                return demands[node]
            return 0
        except (OverflowError, IndexError):
            return 0

    demand_index = routing.RegisterUnaryTransitCallback(demand_callback)
    routing.AddDimensionWithVehicleCapacity(demand_index, 0, [vehicle.capacity_kg for vehicle in request.vehicles], True, "Capacity")
    capacity = routing.GetDimensionOrDie("Capacity")

    def time_callback(from_index: int, to_index: int) -> int:
        source = manager.IndexToNode(from_index)
        target = manager.IndexToNode(to_index)
        condition = road_conditions.get((nodes[source].name, nodes[target].name))
        if condition and condition.closed:
            return 10**9
        weather_factor = max(weather_multiplier(node_weather[source]), weather_multiplier(node_weather[target]))
        delay_multiplier = condition.delay_multiplier if condition else 1.0
        return max(1, int(durations[source][target] * weather_factor * delay_multiplier + service_minutes[source] * 60))

    time_index = routing.RegisterTransitCallback(time_callback)
    max_route_minutes = max(vehicle.max_route_minutes for vehicle in request.vehicles)
    routing.AddDimension(time_index, 0, max_route_minutes * 60, True, "Time")
    route_time_dimension = routing.GetDimensionOrDie("Time")
    for vehicle_index, vehicle in enumerate(request.vehicles):
        route_time_dimension.CumulVar(routing.End(vehicle_index)).SetMax(vehicle.max_route_minutes * 60)

    for pickup, delivery in pairs:
        pickup_index, delivery_index = manager.NodeToIndex(pickup), manager.NodeToIndex(delivery)
        routing.AddPickupAndDelivery(pickup_index, delivery_index)
        routing.solver().Add(routing.VehicleVar(pickup_index) == routing.VehicleVar(delivery_index))
        routing.solver().Add(capacity.CumulVar(pickup_index) <= capacity.CumulVar(delivery_index))

    for order in ordered_orders:
        pickup, delivery = pair_by_order_id[order.id]
        delivery_index = manager.NodeToIndex(delivery)
        route_time_dimension.CumulVar(delivery_index).SetMax(round(order.promised_delivery_hours * 3600))
        if order.needs_cold_chain:
            for vehicle_index, vehicle in enumerate(request.vehicles):
                if not vehicle.refrigerated:
                    routing.solver().Add(routing.VehicleVar(manager.NodeToIndex(pickup)) != vehicle_index)

    parameters = pywrapcp.DefaultRoutingSearchParameters()
    parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    parameters.time_limit.seconds = 5
    
    try:
        solution = routing.SolveWithParameters(parameters)
    except (OverflowError, SystemError) as e:
        raise HTTPException(
            status_code=422,
            detail=f"Routing optimization failed: {str(e)}. Try with fewer orders, smaller vehicle fleet, or larger capacities."
        )
    
    if not solution:
        raise HTTPException(status_code=422, detail="No feasible route. Add vehicle capacity or reduce order quantities.")

    routes, total_distance, total_time = [], 0, 0
    for vehicle_index, vehicle in enumerate(request.vehicles):
        index = routing.Start(vehicle_index)
        route_stops, route_distance, route_time = [], 0, 0
        cumulative_time = 0
        deadline_breaches: list[str] = []

        while not routing.IsEnd(index):
            node = manager.IndexToNode(index)
            load_before = solution.Value(capacity.CumulVar(index))
            weather = node_weather[node]

            # Generate alert if needed
            alert = None
            if weather.risk_level != RiskLevel.SAFE:
                hazard_names = ", ".join(h.value for h in weather.hazards)
                recommendation = {
                    RiskLevel.CAUTION: "Monitor weather; consider adding buffer time",
                    RiskLevel.WARNING: "Reduce speed; be extra cautious",
                    RiskLevel.DANGEROUS: "Consider alternative route or delay delivery",
                }[weather.risk_level]
                alert = DriverAlert(
                    severity=weather.risk_level,
                    message=f"Weather alert: {hazard_names}",
                    hazards=weather.hazards,
                    recommendation=recommendation
                )

            stop_duration = service_minutes[node]
            if stop_duration == 0 and stop_meta[node]["kind"] == "depot":
                stop_duration = 8
            estimated_arrival = round(solution.Value(route_time_dimension.CumulVar(index)) / 60)
            if stop_meta[node]["kind"] == "delivery":
                order = next((item for item in request.orders if item.id == stop_meta[node]["order_id"]), None)
                if order and estimated_arrival > order.promised_delivery_hours * 60:
                    deadline_breaches.append(order.id)
            route_stops.append(RouteStop(
                stop=nodes[node].name,
                latitude=nodes[node].latitude,
                longitude=nodes[node].longitude,
                kind=stop_meta[node]["kind"],
                order_id=stop_meta[node]["order_id"],
                crop=stop_meta[node]["crop"],
                load_before_kg=load_before,
                load_after_kg=load_before + demands[node],
                weather=weather,
                alert=alert,
                estimated_arrival_minutes=estimated_arrival,
                stop_duration_minutes=stop_duration,
            ))

            next_index = solution.Value(routing.NextVar(index))
            next_node = manager.IndexToNode(next_index)
            segment_distance = distances[node][next_node]
            segment_duration = int(durations[node][next_node] * weather_multiplier(node_weather[next_node]))

            route_distance += segment_distance
            route_time += segment_duration
            cumulative_time += segment_duration + stop_duration
            index = next_index

        # Add final stop (return to depot)
        node = manager.IndexToNode(index)
        load_before = solution.Value(capacity.CumulVar(index))
        weather = node_weather[node]
        route_stops.append(RouteStop(
            stop=nodes[node].name,
            latitude=nodes[node].latitude,
            longitude=nodes[node].longitude,
            kind=stop_meta[node]["kind"],
            order_id=stop_meta[node]["order_id"],
            crop=stop_meta[node]["crop"],
            load_before_kg=load_before,
            load_after_kg=load_before + demands[node],
            weather=weather,
            estimated_arrival_minutes=round(solution.Value(route_time_dimension.CumulVar(index)) / 60),
            stop_duration_minutes=5,
        ))

        total_distance += route_distance
        total_time += route_time + sum(stop.stop_duration_minutes for stop in route_stops)

        if len(route_stops) > 2:
            hazard_count: dict[str, int] = {}
            overall_risk = RiskLevel.SAFE
            for stop in route_stops:
                overall_risk = highest_risk(overall_risk, stop.weather.risk_level)
                for hazard in stop.weather.hazards:
                    hazard_count[hazard.value] = hazard_count.get(hazard.value, 0) + 1

            instructions = []
            if overall_risk == RiskLevel.DANGEROUS:
                instructions.append("⚠️  DANGEROUS CONDITIONS - postpone or reroute non-urgent loads")
            elif overall_risk == RiskLevel.WARNING:
                instructions.append("⚠️  WARNING - reduce speed and allow extra travel time")
            elif overall_risk == RiskLevel.CAUTION:
                instructions.append("ℹ️  CAUTION - keep a weather buffer and monitor road updates")

            delivery_count = sum(1 for stop in route_stops if stop.kind == "delivery")
            instructions.append(f"📍 {delivery_count} delivery stops | ⏱️ {round(route_time / 60, 0):.0f} min driving | 🕒 total cycle {round((route_time + sum(stop.stop_duration_minutes for stop in route_stops)) / 60, 1)} min")

            route_card = RouteCard(
                vehicle_id=vehicle.id,
                distance_km=round(route_distance / 1000, 2),
                weather_adjusted_minutes=round((route_time + sum(stop.stop_duration_minutes for stop in route_stops)) / 60, 1),
                stops=route_stops,
                overall_risk=overall_risk,
                hazard_summary=hazard_count,
                driver_instructions=" | ".join(instructions),
                operating_cost_inr=round(vehicle.fixed_trip_cost + route_distance / 1000 * vehicle.fuel_cost_per_km, 2),
                deadline_breaches=sorted(set(deadline_breaches)),
            )
            routes.append(route_card)

    priorities = []
    for order in request.orders:
        pickup_node, delivery_node = pair_by_order_id[order.id]
        score, reason = ai_priority_score(order, node_weather[pickup_node], node_weather[delivery_node])
        priorities.append({
            "order_id": order.id,
            "crop": order.crop,
            "priority_score": score,
            "reason": reason,
            "pickup_risk": node_weather[pickup_node].risk_level,
            "delivery_risk": node_weather[delivery_node].risk_level
        })

    delivery_clusters = build_delivery_clusters(request.orders)
    route_distance_share = max(12.0, total_distance / 1000 / max(1, len(request.orders)))
    pricing_breakdown = [compute_price_breakdown(order, route_distance_share) for order in request.orders]

    return {
        "routes": [r.model_dump() for r in routes],
        "summary": {
            "total_distance_km": round(total_distance / 1000, 2),
            "weather_adjusted_minutes": round(total_time / 60, 1),
            "served_orders": len(request.orders),
            "optimization_objective": "deadline feasibility, weather/road risk, load feasibility, then operating cost",
            "route_constraints": {
                "max_vehicle_route_minutes": max(vehicle.max_route_minutes for vehicle in request.vehicles),
                "road_conditions_applied": len(request.road_conditions),
                "service_minutes_included": True,
            },
        },
        "ai_priorities": sorted(priorities, key=lambda item: item["priority_score"], reverse=True),
        "delivery_clusters": delivery_clusters,
        "logistics_partners": [
            {
                "name": cluster["matched_logistics_partner"],
                "cluster_id": cluster["cluster_id"],
                "orders": cluster["orders"],
                "match_score": cluster["partner_match_score"],
                "recommendation": cluster["recommendation"],
            }
            for cluster in delivery_clusters
        ],
        "pricing_breakdown": pricing_breakdown,
        "price_summary": {
            "total_buyer_value_inr": sum(item["buyer_price_inr"] for item in pricing_breakdown),
            "total_farmer_earnings_inr": sum(item["farmer_earnings_inr"] for item in pricing_breakdown),
            "total_transport_cost_inr": sum(item["transport_cost_inr"] for item in pricing_breakdown),
            "total_platform_fee_inr": sum(item["platform_fee_inr"] for item in pricing_breakdown),
        }
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "FarmLink Route Bot"}


@app.post("/optimize")
async def optimise(request: OptimiseRequest) -> dict:
    """Optimize routes with weather and disaster awareness."""
    points = [request.depot] + [location for order in request.orders for location in (order.pickup, order.delivery)]
    async with httpx.AsyncClient(timeout=12.0) as client:
        weather, matrix = await asyncio.gather(
            asyncio.gather(*(weather_at(client, point) for point in points)),
            road_matrix(client, points)
        )
        durations, distances, routing_source = matrix
        result = build_solution(request, durations, distances, list(weather))
        result["data_sources"] = {"routing": routing_source, "weather": sorted({item.source for item in weather})}
        result["api_version"] = "2.0.0-enhanced"
        return await attach_route_details(client, result)


@app.post("/health-check")
async def health_check(request: OptimiseRequest) -> dict:
    """Detailed health check with sample optimization."""
    try:
        points = [request.depot] + [request.orders[0].pickup, request.orders[0].delivery]
        async with httpx.AsyncClient(timeout=5.0) as client:
            weather_results = await asyncio.gather(*(weather_at(client, point) for point in points))
            matrix_result = await road_matrix(client, points)
        
        return {
            "status": "operational",
            "weather_api": "available" if weather_results[0].source == "open-meteo" else "fallback",
            "routing_api": "available" if matrix_result[2] != "haversine fallback" else "fallback",
            "sample_weather": {
                "depot": weather_results[0].model_dump(),
                "hazards_detected": len(weather_results[0].hazards) > 0
            }
        }
    except Exception as e:
        return {
            "status": "degraded",
            "error": str(e),
            "message": "Using fallback services"
        }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
