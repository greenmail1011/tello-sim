# curve_xyz_speed：先往左繞半圓，再往右繞半圓（S 形）
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

# 經過「前 100、左 100」，飛到「前 200」
tello.curve_xyz_speed(100, 100, 0, 200, 0, 0, 30)
# 經過「前 100、右 100」，再飛到「前 200」
tello.curve_xyz_speed(100, -100, 0, 200, 0, 0, 30)

tello.land()
