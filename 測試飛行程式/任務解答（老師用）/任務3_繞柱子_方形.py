# 任務 3 參考答案（走方形繞過柱子）
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

tello.move_left(100)
tello.move_forward(400)
tello.move_right(200)
tello.move_back(400)
tello.move_left(100)      # 回到起點 H

tello.land()
