import geopandas as gpd
import matplotlib.pyplot as plt

roads = gpd.read_file(
    "hanoi.osm.pbf",
    layer="lines"
)

fig, ax = plt.subplots(
    figsize=(10, 16)
)

roads.plot(
    ax=ax,
    linewidth=0.1,
    color="black"
)

plt.title(
    "Hanoi OSM Road Network"
)

plt.show()