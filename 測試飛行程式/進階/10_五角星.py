# 每次轉 144 度，飛出一顆星星
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

for i in range(5):
    tello.move_forward(150)
    tello.rotate_clockwise(144)

tello.land()
