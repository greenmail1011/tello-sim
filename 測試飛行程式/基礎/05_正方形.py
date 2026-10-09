# 用 for 迴圈飛一個邊長 1 公尺的正方形
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

for i in range(4):
    tello.move_forward(100)
    tello.rotate_counter_clockwise(90)

tello.land()
