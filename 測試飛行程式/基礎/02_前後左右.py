# 往前、往右、往後、往左各飛 1 公尺，回到原點
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

tello.move_forward(100)
tello.move_right(100)
tello.move_back(100)
tello.move_left(100)

tello.land()
