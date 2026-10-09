# 改 sides 的數字，就能飛出不同的多邊形
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

sides = 6                    # 試試看改成 3、4、5、8
angle = int(360 / sides)     # 角度要是整數
length = 80

for i in range(sides):
    tello.move_forward(length)
    tello.rotate_counter_clockwise(angle)

tello.land()
